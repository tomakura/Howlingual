import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { getExecutionPlan } from "./translation_policy";
import { getProviderForModel, type AiProvider } from "./ai_models";

// Environment variables
const ENV = import.meta.env;

// Clients are initialized dynamically or via env fallback

// Dynamic Client Getters
function getGeminiClient(apiKey?: string) {
	const key = apiKey || ENV.VITE_GOOGLE_GENERATIVE_AI_API_KEY;
	if (!key) throw new Error("Gemini API Key missing");
	return new GoogleGenerativeAI(key);
}

function getOpenAIClient(apiKey?: string) {
	const key = apiKey || ENV.VITE_OPENAI_API_KEY;
	if (!key) throw new Error("OpenAI API Key missing");
	return new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
}

function getAnthropicClient(apiKey?: string) {
	const key = apiKey || ENV.VITE_ANTHROPIC_API_KEY;
	if (!key) throw new Error("Anthropic API Key missing");
	return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";

function resolveGroqApiKey(apiKey?: string) {
	return apiKey || ENV.VITE_GROQ_API_KEY;
}

function resolveCerebrasApiKey(apiKey?: string) {
	return apiKey || ENV.VITE_CEREBRAS_API_KEY;
}

export type AiModel = string;

export interface TranslationResult {
	id?: number;
	text: string;
	reason: string;
}

export interface UsageMetadata {
	input_tokens: number;
	output_tokens: number;
}

export interface AiResponse {
	detected_source_language: string;
	candidates: TranslationResult[];
	detailed_explanation?: {
		points: { term: string; explanation: string }[];
	};
	usage?: UsageMetadata;
}

function normalizeJsonText(raw: string): string {
	return raw
		.replace(/```json/gi, "```")
		.replace(/```/g, "")
		.trim();
}

function extractJsonFromText(raw: string): string | null {
	const cleaned = normalizeJsonText(raw);
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return null;
	return cleaned.slice(start, end + 1);
}

function parseJsonFromText<T>(raw: string): T {
	const cleaned = normalizeJsonText(raw);
	try {
		return JSON.parse(cleaned) as T;
	} catch {
		const extracted = extractJsonFromText(cleaned);
		if (extracted) {
			return JSON.parse(extracted) as T;
		}
		throw new Error("Failed to parse JSON response");
	}
}

function buildProviderHeaders(
	apiKey: string | undefined,
	extra: Record<string, string> = {},
) {
	if (!apiKey) throw new Error("API Key missing");
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		...extra,
	};
	if (typeof window === "undefined") {
		headers["User-Agent"] = "Howlingual/1.0";
	}
	return headers;
}

function mapUsageToMetadata(usage: any): UsageMetadata | undefined {
	if (!usage || typeof usage !== "object") return undefined;
	const input =
		usage.prompt_tokens ??
		usage.input_tokens ??
		usage.promptTokenCount ??
		usage.inputTokenCount;
	const output =
		usage.completion_tokens ??
		usage.output_tokens ??
		usage.candidatesTokenCount ??
		usage.outputTokenCount;
	if (typeof input !== "number" && typeof output !== "number") return undefined;
	return {
		input_tokens: typeof input === "number" ? input : 0,
		output_tokens: typeof output === "number" ? output : 0,
	};
}

async function fetchChatCompletionJson(params: {
	url: string;
	apiKey?: string;
	body: any;
	signal?: AbortSignal;
}) {
	const res = await fetch(params.url, {
		method: "POST",
		headers: buildProviderHeaders(params.apiKey),
		body: JSON.stringify(params.body),
		signal: params.signal,
	});
	if (!res.ok) {
		const text = await res.text();
		let message = `HTTP ${res.status} ${res.statusText}`;
		try {
			const data = JSON.parse(text);
			message =
				data?.error?.message ||
				data?.message ||
				data?.error ||
				message;
		} catch {
			// ignore parse errors
		}
		const err: any = new Error(message);
		err.status = res.status;
		err.body = text;
		throw err;
	}
	return res.json();
}

async function streamChatCompletion(params: {
	url: string;
	apiKey?: string;
	body: any;
	signal?: AbortSignal;
	onDelta: (delta: string) => void;
	onUsage?: (usage: UsageMetadata) => void;
}) {
	const res = await fetch(params.url, {
		method: "POST",
		headers: buildProviderHeaders(params.apiKey, {
			Accept: "text/event-stream",
		}),
		body: JSON.stringify(params.body),
		signal: params.signal,
	});
	if (!res.ok) {
		const text = await res.text();
		let message = `HTTP ${res.status} ${res.statusText}`;
		try {
			const data = JSON.parse(text);
			message =
				data?.error?.message ||
				data?.message ||
				data?.error ||
				message;
		} catch {
			// ignore parse errors
		}
		const err: any = new Error(message);
		err.status = res.status;
		err.body = text;
		throw err;
	}
	if (!res.body) throw new Error("No response body");
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() || "";
		for (const line of lines) {
			if (!line.startsWith("data:")) continue;
			const data = line.slice(5).trim();
			if (!data) continue;
			if (data === "[DONE]") return;
			try {
				const parsed = JSON.parse(data);
				const delta = parsed?.choices?.[0]?.delta?.content || "";
				if (delta) params.onDelta(delta);
				const usage = mapUsageToMetadata(parsed?.usage);
				if (usage && params.onUsage) params.onUsage(usage);
			} catch {
				continue;
			}
		}
	}
}

type JsonStringRead = {
	value: string;
	end: number;
	complete: boolean;
};

function skipJsonWhitespace(raw: string, index: number, until = raw.length) {
	let i = index;
	while (i < until && /\s/.test(raw[i])) i += 1;
	return i;
}

function readJsonStringValue(raw: string, quoteIndex: number, until = raw.length): JsonStringRead | null {
	if (raw[quoteIndex] !== "\"") return null;
	let value = "";
	let i = quoteIndex + 1;
	while (i < until) {
		const ch = raw[i];
		if (ch === "\\") {
			const next = raw[i + 1];
			if (!next || i + 1 >= until) {
				return { value, end: until, complete: false };
			}
			if (next === "u") {
				const hex = raw.slice(i + 2, i + 6);
				if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
					return { value, end: until, complete: false };
				}
				value += String.fromCharCode(parseInt(hex, 16));
				i += 6;
				continue;
			}
			const escaped: Record<string, string> = {
				"\"": "\"",
				"\\": "\\",
				"/": "/",
				b: "\b",
				f: "\f",
				n: "\n",
				r: "\r",
				t: "\t",
			};
			value += escaped[next] ?? next;
			i += 2;
			continue;
		}
		if (ch === "\"") {
			return { value, end: i + 1, complete: true };
		}
		value += ch;
		i += 1;
	}
	return { value, end: until, complete: false };
}

function findJsonPropertyKey(raw: string, key: string, from = 0, until = raw.length) {
	const pattern = `"${key}"`;
	let inString = false;
	let escaped = false;
	for (let i = from; i < until; i += 1) {
		const ch = raw[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === "\"") {
				inString = false;
			}
			continue;
		}
		if (ch !== "\"") continue;
		if (raw.startsWith(pattern, i)) {
			const afterKey = skipJsonWhitespace(raw, i + pattern.length, until);
			if (raw[afterKey] === ":") return i;
		}
		inString = true;
	}
	return -1;
}

function readJsonStringProperty(raw: string, key: string, from = 0, until = raw.length): JsonStringRead | null {
	const keyIndex = findJsonPropertyKey(raw, key, from, until);
	if (keyIndex === -1) return null;
	const colonIndex = raw.indexOf(":", keyIndex);
	if (colonIndex === -1 || colonIndex >= until) return null;
	const valueIndex = skipJsonWhitespace(raw, colonIndex + 1, until);
	return readJsonStringValue(raw, valueIndex, until);
}

function findJsonArrayValueStart(raw: string, key: string, from = 0, until = raw.length) {
	const keyIndex = findJsonPropertyKey(raw, key, from, until);
	if (keyIndex === -1) return -1;
	const colonIndex = raw.indexOf(":", keyIndex);
	if (colonIndex === -1 || colonIndex >= until) return -1;
	const valueIndex = skipJsonWhitespace(raw, colonIndex + 1, until);
	return raw[valueIndex] === "[" ? valueIndex : -1;
}

function findJsonContainerEnd(raw: string, start: number, open: string, close: string) {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < raw.length; i += 1) {
		const ch = raw[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === "\"") {
				inString = false;
			}
			continue;
		}
		if (ch === "\"") {
			inString = true;
		} else if (ch === open) {
			depth += 1;
		} else if (ch === close) {
			depth -= 1;
			if (depth === 0) return i + 1;
		}
	}
	return raw.length;
}

function isStructurallyCompleteJson(raw: string) {
	let depth = 0;
	let inString = false;
	let escaped = false;
	let started = false;
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === "\"") {
				inString = false;
			}
			continue;
		}
		if (ch === "\"") {
			inString = true;
		} else if (ch === "{" || ch === "[") {
			depth += 1;
			started = true;
		} else if (ch === "}" || ch === "]") {
			depth -= 1;
			if (depth < 0) return false;
		}
	}
	return started && depth === 0 && !inString;
}

function parseCandidateObject(raw: string): TranslationResult | null {
	const text = readJsonStringProperty(raw, "text");
	const reason = readJsonStringProperty(raw, "reason");
	if (!text && !reason) return null;
	const candidate: Partial<TranslationResult> = {};
	if (text) candidate.text = text.value;
	if (reason) candidate.reason = reason.value;
	return candidate as TranslationResult;
}

function extractPartialCandidates(raw: string, maxCandidates: number) {
	const candidatesStart = findJsonArrayValueStart(raw, "candidates");
	if (candidatesStart === -1) return [];
	const candidatesEnd = findJsonContainerEnd(raw, candidatesStart, "[", "]");
	const candidates: TranslationResult[] = [];
	let objectStart = -1;
	let objectDepth = 0;
	let inString = false;
	let escaped = false;

	for (let i = candidatesStart + 1; i < candidatesEnd && candidates.length < maxCandidates; i += 1) {
		const ch = raw[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === "\"") {
				inString = false;
			}
			continue;
		}
		if (ch === "\"") {
			inString = true;
		} else if (ch === "{") {
			if (objectDepth === 0) objectStart = i;
			objectDepth += 1;
		} else if (ch === "}" && objectDepth > 0) {
			objectDepth -= 1;
			if (objectDepth === 0 && objectStart !== -1) {
				const candidate = parseCandidateObject(raw.slice(objectStart, i + 1));
				if (candidate) candidates.push(candidate);
				objectStart = -1;
			}
		}
	}

	if (objectDepth > 0 && objectStart !== -1 && candidates.length < maxCandidates) {
		const candidate = parseCandidateObject(raw.slice(objectStart, candidatesEnd));
		if (candidate) candidates.push(candidate);
	}

	return candidates;
}

export function parsePartialAiResponseFromStream(
	raw: string,
	candidateCount = 3,
): Partial<AiResponse> | null {
	const cleaned = normalizeJsonText(raw);
	const start = cleaned.indexOf("{");
	const trimmed = (start >= 0 ? cleaned.slice(start) : cleaned).replace(/,$/, "");
	if (!trimmed) return null;

	const partial: Partial<AiResponse> = {};
	const detected = readJsonStringProperty(trimmed, "detected_source_language");
	if (detected) partial.detected_source_language = detected.value;

	const candidates = extractPartialCandidates(trimmed, candidateCount);
	if (candidates.length > 0) partial.candidates = candidates;

	return Object.keys(partial).length > 0 ? partial : null;
}

function getPartialStreamKey(partial: Partial<AiResponse>) {
	const values: string[] = [partial.detected_source_language ?? ""];
	for (const candidate of partial.candidates ?? []) {
		values.push(candidate.text ?? "", candidate.reason ?? "");
	}
	for (const point of partial.detailed_explanation?.points ?? []) {
		values.push(point.term ?? "", point.explanation ?? "");
	}
	return values.join("\u001f");
}

function isReasoningModelName(modelName: string): boolean {
	return (
		modelName.includes("gpt-5.5") ||
		modelName.includes("gpt-oss") ||
		modelName.includes("o1") ||
		modelName.includes("o3") ||
		modelName.includes("qwq") ||
		modelName.includes("deepseek-r1") ||
		modelName.includes("k2-instruct")
	);
}

export function shouldUseOpenAIResponses(modelName: string): boolean {
	return modelName.startsWith("gpt-5.5");
}

function getErrorStatus(err: unknown): number | undefined {
	if (!err || typeof err !== "object") return undefined;
	const anyErr = err as any;
	return (
		anyErr.status ??
		anyErr.statusCode ??
		anyErr.response?.status ??
		anyErr.error?.status ??
		undefined
	);
}

function getErrorMessage(err: unknown): string {
	if (!err) return "";
	if (typeof err === "string") return err;
	if (typeof err === "object") {
		const anyErr = err as any;
		return (
			anyErr.error?.message ||
			anyErr.message ||
			(anyErr.error ? JSON.stringify(anyErr.error) : "") ||
			String(err)
		);
	}
	return String(err);
}

function shouldRetryWithoutJson(err: unknown): boolean {
	const status = getErrorStatus(err);
	if (status !== 400) return false;
	const message = getErrorMessage(err).toLowerCase();
	return (
		message.includes("failed_generation") ||
		message.includes("response_format") ||
		message.includes("json") ||
		message.includes("schema")
	);
}

// Build system prompt with configurable explanation language
function buildSystemPrompt(
	explanationLang: string = "日本語",
	candidateCount: number = 3,
): string {
	return `
あなたはプロの翻訳者です。
ユーザーから提供された原文を、指定された言語へ翻訳してください。

[翻訳のルール]
1. **厳密に${candidateCount}つの翻訳案**を作成すること。
	- 1つ目: 文脈を考慮した、最も最適で自然な翻訳。
	- 2つ目以降: ニュアンスや表現を変えたバリエーション。
2. **detected_source_language**: 原文の言語を判定し、${explanationLang}で出力すること。
3. 各翻訳案の「reason」と「detailed_explanation」は**${explanationLang}で**書くこと。
4. **detailed_explanation**: 重要な単語や文法ポイントを3つ程度ピックアップし、${explanationLang}で詳しく解説すること。
5. 出力は必ず以下のJSON形式のみで行うこと（余計な説明や前置き、Markdown、コードフェンスは禁止）。
6. ストリーム表示のため、次の順に出力を進めること:
   detected_source_language → candidates[].text → candidates[].reason → detailed_explanation。
7. 文字列内の引用符や改行は、必ずJSONとして正しくエスケープすること。

\`\`\`json
{
  "detected_source_language": "ソース言語",
  "candidates": [
    {
      "text": "翻訳案",
      "reason": "解説 (${explanationLang})"
    }
  ],
  "detailed_explanation": {
    "points": [
      {
        "term": "原文の単語やフレーズ",
        "explanation": "解説 (${explanationLang})"
      }
    ]
  }
}
\`\`\`
`;
}

// Legacy constant for backward compatibility
const SYSTEM_PROMPT = buildSystemPrompt("日本語", 3);

// Helper to construct user prompt
function buildUserPrompt(
	text: string,
	sourceLang: string,
	targetLang: string,
	styles: Record<string, number>,
	styleMeta: Record<string, { name: string; prompt?: string }> = {},
) {
	const activeStyles = Object.entries(styles)
		.filter(([_, level]) => level > 0)
		.map(([styleId, level]) => {
			const meta = styleMeta[styleId];
			const label = meta?.name ?? styleId;
			const prompt = meta?.prompt ? ` (${meta.prompt})` : "";
			return `${label}${prompt} (強度: ${level === 2 ? "強" : "弱"})`;
		})
		.join(", ");

	return `
	[入力情報]
	原文: "${text}"
	翻訳元言語: ${sourceLang === "自動検出" ? "自動検出 (Auto-detect)" : sourceLang}
	翻訳先言語: ${targetLang}
	${activeStyles ? `適用する文体・トーン: ${activeStyles}` : ""}
  `;
}

// Gemini Implementation
async function callGemini(
	modelName: string,
	prompt: string,
	systemPrompt: string = SYSTEM_PROMPT,
	apiKey?: string,
): Promise<AiResponse> {
	const client = getGeminiClient(apiKey);

	const schema = {
		type: SchemaType.OBJECT,
		properties: {
			detected_source_language: { type: SchemaType.STRING, description: "Detected language in Japanese" },
			candidates: {
				type: SchemaType.ARRAY,
				items: {
					type: SchemaType.OBJECT,
					properties: {
						text: { type: SchemaType.STRING, description: "Translated text" },
						reason: { type: SchemaType.STRING, description: "Explanation in Japanese" }
					},
					required: ["text", "reason"]
				}
			},
			detailed_explanation: {
				type: SchemaType.OBJECT,
				properties: {
					points: {
						type: SchemaType.ARRAY,
						items: {
							type: SchemaType.OBJECT,
							properties: {
								term: { type: SchemaType.STRING },
								explanation: { type: SchemaType.STRING }
							},
							required: ["term", "explanation"]
						}
					}
				},
				required: ["points"]
			}
		},
		required: ["detected_source_language", "candidates", "detailed_explanation"]
	} as const;

	const model = client.getGenerativeModel({
		model: modelName || "gemini-1.5-flash",
		systemInstruction: systemPrompt,
		generationConfig: {
			responseMimeType: "application/json",
			responseSchema: schema as any
		}
	});

	const result = await model.generateContent(prompt);
	const parsed = parseJsonFromText<AiResponse>(result.response.text());
	if (result.response.usageMetadata) {
		parsed.usage = {
			input_tokens: result.response.usageMetadata.promptTokenCount,
			output_tokens: result.response.usageMetadata.candidatesTokenCount,
		};
	}
	return parsed;
}

// OpenAI Implementation
async function callOpenAI(
	modelName: string,
	prompt: string,
	systemPrompt: string = SYSTEM_PROMPT,
	apiKey?: string,
	signal?: AbortSignal,
	jsonMode = true,
): Promise<AiResponse> {
	const client = getOpenAIClient(apiKey);
	if (shouldUseOpenAIResponses(modelName)) {
		return callOpenAIResponses(client, modelName, prompt, systemPrompt, {
			signal,
			jsonMode,
		});
	}
	return callOpenAICompatible(client, modelName, prompt, systemPrompt, {
		signal,
		jsonMode,
	});
}

function responseOutputText(response: any): string {
	if (typeof response?.output_text === "string") return response.output_text;
	const chunks: string[] = [];
	for (const item of response?.output ?? []) {
		for (const content of item?.content ?? []) {
			if (content?.type === "output_text" && typeof content.text === "string") {
				chunks.push(content.text);
			}
		}
	}
	return chunks.join("");
}

export function buildOpenAIResponsesBody(
	modelName: string,
	prompt: string,
	systemPrompt: string,
	options: { jsonMode?: boolean; stream?: boolean } = {},
) {
	const body: any = {
		model: modelName,
		instructions: systemPrompt,
		input: prompt,
		store: false,
	};
	if (options.jsonMode !== false) {
		body.text = { format: { type: "json_object" }, verbosity: "low" };
	} else {
		body.text = { verbosity: "low" };
	}
	if (isReasoningModelName(modelName)) {
		body.reasoning = { effort: "low" };
	}
	if (options.stream) {
		body.stream = true;
	}
	return body;
}

async function callOpenAIResponses(
	openai: OpenAI,
	modelName: string,
	prompt: string,
	systemPrompt: string,
	options: { signal?: AbortSignal; jsonMode?: boolean } = {},
): Promise<AiResponse> {
	const response = await openai.responses.create(
		buildOpenAIResponsesBody(modelName, prompt, systemPrompt, {
			jsonMode: options.jsonMode,
		}),
		{ signal: options.signal },
	);

	const content = responseOutputText(response);
	if (!content) throw new Error("No content from OpenAI Responses");

	const parsed = parseJsonFromText<AiResponse>(content);
	const usage = mapUsageToMetadata((response as any).usage);
	if (usage) parsed.usage = usage;
	return parsed;
}

async function callOpenAICompatible(
	openai: OpenAI,
	modelName: string,
	prompt: string,
	systemPrompt: string,
	options: { signal?: AbortSignal; jsonMode?: boolean } = {},
): Promise<AiResponse> {
	const requestParams: any = {
		model: modelName,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: prompt },
		],
	};

	if (options.jsonMode !== false) {
		requestParams.response_format = { type: "json_object" };
	}

	if (isReasoningModelName(modelName)) {
		requestParams.reasoning_effort = "low";
	}

	const completion = await openai.chat.completions.create(requestParams, {
		signal: options.signal,
	});

	const content = completion.choices[0].message.content;
	if (!content) throw new Error("No content from OpenAI");

	const parsed = parseJsonFromText<AiResponse>(content);
	if (completion.usage) {
		parsed.usage = {
			input_tokens: completion.usage.prompt_tokens,
			output_tokens: completion.usage.completion_tokens,
		};
	}
	return parsed;
}

async function callGroqDirect(
	modelName: string,
	prompt: string,
	systemPrompt: string,
	apiKey?: string,
	signal?: AbortSignal,
	jsonMode = true,
): Promise<AiResponse> {
	const resolvedKey = resolveGroqApiKey(apiKey);
	const requestParams: any = {
		model: modelName,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: prompt },
		],
	};
	if (jsonMode) {
		requestParams.response_format = { type: "json_object" };
	}
	if (isReasoningModelName(modelName)) {
		requestParams.reasoning_effort = "low";
	}
	const data = await fetchChatCompletionJson({
		url: `${GROQ_BASE_URL}/chat/completions`,
		apiKey: resolvedKey,
		body: requestParams,
		signal,
	});
	const content = data?.choices?.[0]?.message?.content;
	if (!content) throw new Error("No content from Groq");
	const parsed = parseJsonFromText<AiResponse>(content);
	const usage = mapUsageToMetadata(data?.usage);
	if (usage) parsed.usage = usage;
	return parsed;
}

async function callCerebrasDirect(
	modelName: string,
	prompt: string,
	systemPrompt: string,
	apiKey?: string,
	signal?: AbortSignal,
	jsonMode = true,
): Promise<AiResponse> {
	const resolvedKey = resolveCerebrasApiKey(apiKey);
	const requestParams: any = {
		model: modelName,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: prompt },
		],
	};
	if (jsonMode) {
		requestParams.response_format = { type: "json_object" };
	}
	if (isReasoningModelName(modelName)) {
		requestParams.reasoning_effort = "low";
	}
	const data = await fetchChatCompletionJson({
		url: `${CEREBRAS_BASE_URL}/chat/completions`,
		apiKey: resolvedKey,
		body: requestParams,
		signal,
	});
	const content = data?.choices?.[0]?.message?.content;
	if (!content) throw new Error("No content from Cerebras");
	const parsed = parseJsonFromText<AiResponse>(content);
	const usage = mapUsageToMetadata(data?.usage);
	if (usage) parsed.usage = usage;
	return parsed;
}

// Anthropic Implementation
async function callAnthropic(
	modelName: string,
	prompt: string,
	systemPrompt: string = SYSTEM_PROMPT,
	apiKey?: string,
	signal?: AbortSignal,
): Promise<AiResponse> {
	const client = getAnthropicClient(apiKey);

	// Anthropic doesn't support JSON mode natively like OpenAI/Gemini yet in the same way,
	// so we append "Output JSON only" instruction excessively.
	const msg = await client.messages.create(
		{
		model: modelName,
		max_tokens: 1024,
		system: systemPrompt + "\n\nOutput strictly valid JSON.",
		messages: [{ role: "user", content: prompt }]
		},
		{ signal },
	);

	const contentBlock = msg.content[0];
	if (contentBlock.type !== 'text') throw new Error("Unexpected Anthropic response type");

	const parsed = parseJsonFromText<AiResponse>(contentBlock.text);
	if (msg.usage) {
		parsed.usage = {
			input_tokens: msg.usage.input_tokens,
			output_tokens: msg.usage.output_tokens,
		};
	}
	return parsed;
}

// Helper to safely parse partial JSON while avoiding repeated repair parses per token.
function tryParsePartialJson(
	jsonStr: string,
	candidateCount = 3,
): Partial<AiResponse> | null {
	const cleaned = normalizeJsonText(jsonStr);
	const start = cleaned.indexOf("{");
	const trimmed = (start >= 0 ? cleaned.slice(start) : cleaned).replace(
		/,$/,
		"",
	);

	if (isStructurallyCompleteJson(trimmed)) {
		try {
			return JSON.parse(trimmed);
		} catch {
			const extracted = extractJsonFromText(trimmed);
			if (extracted) {
				try {
					return JSON.parse(extracted);
				} catch {
					// Fall back to scanner below.
				}
			}
		}
	}

	return parsePartialAiResponseFromStream(trimmed, candidateCount);
}

// Stream Translation Router
export async function translateTextStream(
	text: string,
	sourceLang: string,
	targetLang: string,
	styles: Record<string, number>,
	model: string,
	onUpdate: (partial: Partial<AiResponse>, usage?: UsageMetadata) => void,
	explanationLang: string = "日本語",
	styleMeta: Record<string, { name: string; prompt?: string }> = {},
	apiKeys: Record<string, string> = {},
	options: { provider?: AiProvider | null; signal?: AbortSignal } = {},
	candidateCount: number = 3,
): Promise<void> {
	const userPrompt = buildUserPrompt(text, sourceLang, targetLang, styles, styleMeta);
	const systemPrompt = buildSystemPrompt(explanationLang, candidateCount);
	const provider = options.provider ?? getProviderForModel(model) ?? undefined;
	const signal = options.signal;
	const plan = getExecutionPlan({
		provider,
		model,
		streamingDisplay: true,
	});

	if (plan.mode === "non_stream") {
		if (signal?.aborted) return;
		const response = await translateText(
			text,
			sourceLang,
			targetLang,
			styles,
			model as AiModel,
			styleMeta,
			candidateCount,
			{
				provider: provider ?? undefined,
				apiKeys,
				explanationLang,
				signal,
				jsonMode: plan.jsonMode,
			},
		);
		onUpdate(response, response.usage);
		return;
	}

	if (provider === "gemini" || model.startsWith("gemini")) {
		await streamGemini(
			model,
			userPrompt,
			onUpdate,
			systemPrompt,
			apiKeys.google?.trim() || apiKeys.gemini?.trim(),
			signal,
			candidateCount,
		);
	} else if (provider === "groq") {
		await streamGroq(
			model,
			userPrompt,
			onUpdate,
			systemPrompt,
			apiKeys.groq?.trim(),
			signal,
			plan.jsonMode,
			candidateCount,
		);
	} else if (provider === "cerebras") {
		await streamCerebras(
			model,
			userPrompt,
			onUpdate,
			systemPrompt,
			apiKeys.cerebras?.trim(),
			signal,
			plan.jsonMode,
			candidateCount,
		);
	} else if (provider === "anthropic" || model.startsWith("claude")) {
		await streamAnthropic(
			model,
			userPrompt,
			onUpdate,
			systemPrompt,
			apiKeys.anthropic?.trim(),
			signal,
			candidateCount,
		);
	} else if (provider === "openai" || model.startsWith("gpt") || model.startsWith("o3")) {
		await streamOpenAI(
			model,
			userPrompt,
			onUpdate,
			systemPrompt,
			apiKeys.openai?.trim(),
			signal,
			plan.jsonMode,
			candidateCount,
		);
	} else {
		throw new Error(`Unsupported model: ${model}`);
	}
}

// Gemini Streaming
async function streamGemini(
	modelName: string,
	prompt: string,
	onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void,
	systemPrompt: string,
	apiKey?: string,
	signal?: AbortSignal,
	candidateCount = 3,
) {
	const genAI = getGeminiClient(apiKey);

	const model = genAI.getGenerativeModel({
		model: modelName,
		systemInstruction: systemPrompt,
		generationConfig: {
			responseMimeType: "application/json"
		},
	});

	const result = await model.generateContentStream(prompt, { signal });

	let accumulatedText = "";
	let lastPartialKey = "";

	for await (const chunk of result.stream) {
		if (signal?.aborted) return;
		const chunkText = chunk.text();
		accumulatedText += chunkText;

		const partial = tryParsePartialJson(accumulatedText, candidateCount);
		if (partial) {
			const key = getPartialStreamKey(partial);
			if (key !== lastPartialKey) {
				lastPartialKey = key;
				onUpdate(partial);
			}
		}
	}
	// Final safe parse to ensure everything is correct
	try {
		if (signal?.aborted) return;
		const final = parseJsonFromText<AiResponse>(accumulatedText);
		const response = await result.response;
		const usage = response.usageMetadata
			? {
					input_tokens: response.usageMetadata.promptTokenCount,
					output_tokens: response.usageMetadata.candidatesTokenCount,
				}
			: undefined;
		if (usage) console.debug("[Gemini] Token Usage:", usage);

		onUpdate(final, usage);
	} catch (e) {
		console.warn("Gemini final parse/usage error:", e);
	}
}

// OpenAI Streaming
async function streamOpenAICompatible(
	openai: OpenAI,
	modelName: string,
	prompt: string,
	onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void,
	systemPrompt: string,
	signal?: AbortSignal,
	jsonMode = true,
	candidateCount = 3,
) {
	const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
		model: modelName,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: prompt }
		],
		stream: true,
		stream_options: { include_usage: true }
	};

	if (jsonMode) {
		requestParams.response_format = { type: "json_object" };
	}

	// Only add reasoning_effort for models that support it
	if (isReasoningModelName(modelName)) {
		(requestParams as any).reasoning_effort = "low";
	}

	const stream = await openai.chat.completions.create(requestParams, { signal });

	let accumulatedText = "";
	let lastPartialKey = "";
	for await (const chunk of stream) {
		if (signal?.aborted) return;
		const content = chunk.choices[0]?.delta?.content || "";

		if (chunk.usage) {
			const partialForUsage =
				tryParsePartialJson(accumulatedText, candidateCount) || {};
			onUpdate(partialForUsage, {
				input_tokens: chunk.usage.prompt_tokens,
				output_tokens: chunk.usage.completion_tokens,
			});
			console.debug("[OpenAI] Token Usage:", chunk.usage);
		}

		if (content) {
			accumulatedText += content;
			const partial = tryParsePartialJson(accumulatedText, candidateCount);
			if (partial) {
				const key = getPartialStreamKey(partial);
				if (key !== lastPartialKey) {
					lastPartialKey = key;
					onUpdate(partial);
				}
			}
		}
	}
	// Final safe parse (User requested "complete version" check)
	// Even though OpenAI streams deltas, accumulatedText IS the complete version at this point.
	try {
		if (accumulatedText.trim()) {
			const final = parseJsonFromText<AiResponse>(accumulatedText);
			console.debug("[OpenAI] Final full JSON parsed successfully.");
			// Usage is already handled via chunk.usage in the loop (final chunk usually has it)
			onUpdate(final);
		}
	} catch (e) {
		console.warn("[OpenAI] Final JSON parse failed:", e);
	}
}

async function streamOpenAIResponses(
	openai: OpenAI,
	modelName: string,
	prompt: string,
	onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void,
	systemPrompt: string,
	signal?: AbortSignal,
	jsonMode = true,
	candidateCount = 3,
) {
	const stream = await openai.responses.create(
		buildOpenAIResponsesBody(modelName, prompt, systemPrompt, {
			jsonMode,
			stream: true,
		}),
		{ signal },
	);

	let accumulatedText = "";
	let lastPartialKey = "";
	let finalUsage: UsageMetadata | undefined;

	for await (const event of stream as any) {
		if (signal?.aborted) return;
		if (event.type === "response.output_text.delta" && event.delta) {
			accumulatedText += event.delta;
			const partial = tryParsePartialJson(accumulatedText, candidateCount);
			if (partial) {
				const key = getPartialStreamKey(partial);
				if (key !== lastPartialKey) {
					lastPartialKey = key;
					onUpdate(partial);
				}
			}
		} else if (event.type === "response.completed") {
			finalUsage = mapUsageToMetadata(event.response?.usage);
		} else if (event.type === "response.failed") {
			throw new Error(
				event.response?.error?.message ||
					event.response?.error?.code ||
					"OpenAI Responses stream failed",
			);
		} else if (event.type === "response.error") {
			throw new Error(event.message || "OpenAI Responses stream error");
		}
	}

	try {
		if (accumulatedText.trim()) {
			const final = parseJsonFromText<AiResponse>(accumulatedText);
			onUpdate(final, finalUsage);
		} else if (finalUsage) {
			onUpdate({}, finalUsage);
		}
	} catch (e) {
		console.warn("[OpenAI Responses] Final JSON parse failed:", e);
	}
}

async function streamProviderChatCompletion(params: {
	url: string;
	apiKey?: string;
	modelName: string;
	prompt: string;
	onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void;
	systemPrompt: string;
	signal?: AbortSignal;
	jsonMode: boolean;
	candidateCount: number;
}) {
	const requestParams: any = {
		model: params.modelName,
		messages: [
			{ role: "system", content: params.systemPrompt },
			{ role: "user", content: params.prompt },
		],
		stream: true,
	};
	if (params.jsonMode) {
		requestParams.response_format = { type: "json_object" };
	}
	if (isReasoningModelName(params.modelName)) {
		requestParams.reasoning_effort = "low";
	}

	let accumulatedText = "";
	let lastPartialKey = "";
	await streamChatCompletion({
		url: params.url,
		apiKey: params.apiKey,
		body: requestParams,
		signal: params.signal,
		onDelta: (delta) => {
			accumulatedText += delta;
			const partial = tryParsePartialJson(
				accumulatedText,
				params.candidateCount,
			);
			if (partial) {
				const key = getPartialStreamKey(partial);
				if (key !== lastPartialKey) {
					lastPartialKey = key;
					params.onUpdate(partial);
				}
			}
		},
		onUsage: (usage) => {
			const partialForUsage =
				tryParsePartialJson(accumulatedText, params.candidateCount) || {};
			params.onUpdate(partialForUsage, usage);
		},
	});

	try {
		if (accumulatedText.trim()) {
			const final = parseJsonFromText<AiResponse>(accumulatedText);
			params.onUpdate(final);
		}
	} catch (e) {
		console.warn("[Stream] Final JSON parse failed:", e);
	}
}

async function streamOpenAI(
	modelName: string,
	prompt: string,
	onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void,
	systemPrompt: string,
	apiKey?: string,
	signal?: AbortSignal,
	jsonMode = true,
	candidateCount = 3,
) {
	const openai = getOpenAIClient(apiKey);
	if (shouldUseOpenAIResponses(modelName)) {
		await streamOpenAIResponses(
			openai,
			modelName,
			prompt,
			onUpdate,
			systemPrompt,
			signal,
			jsonMode,
			candidateCount,
		);
		return;
	}
	await streamOpenAICompatible(
		openai,
		modelName,
		prompt,
		onUpdate,
		systemPrompt,
		signal,
		jsonMode,
		candidateCount,
	);
}

async function streamGroq(
	modelName: string,
	prompt: string,
	onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void,
	systemPrompt: string,
	apiKey?: string,
	signal?: AbortSignal,
	jsonMode = true,
	candidateCount = 3,
) {
	const resolvedKey = resolveGroqApiKey(apiKey);
	await streamProviderChatCompletion({
		url: `${GROQ_BASE_URL}/chat/completions`,
		apiKey: resolvedKey,
		modelName,
		prompt,
		onUpdate,
		systemPrompt,
		signal,
		jsonMode,
		candidateCount,
	});
}

async function streamCerebras(
	modelName: string,
	prompt: string,
	onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void,
	systemPrompt: string,
	apiKey?: string,
	signal?: AbortSignal,
	jsonMode = true,
	candidateCount = 3,
) {
	const resolvedKey = resolveCerebrasApiKey(apiKey);
	await streamProviderChatCompletion({
		url: `${CEREBRAS_BASE_URL}/chat/completions`,
		apiKey: resolvedKey,
		modelName,
		prompt,
		onUpdate,
		systemPrompt,
		signal,
		jsonMode,
		candidateCount,
	});
}

// Anthropic Streaming
async function streamAnthropic(
	modelName: string,
	prompt: string,
	onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void,
	systemPrompt: string,
	apiKey?: string,
	signal?: AbortSignal,
	candidateCount = 3,
) {
	const anthropic = getAnthropicClient(apiKey);

	const stream = await anthropic.messages.create(
		{
			model: modelName,
			max_tokens: 1024,
			system: systemPrompt + "\n\nOutput strictly valid JSON.",
			messages: [{ role: "user", content: prompt }],
			stream: true
		},
		{ signal }
	);

	let accumulatedText = "";
	let lastPartialKey = "";
	let currentUsage: UsageMetadata = { input_tokens: 0, output_tokens: 0 };

	for await (const chunk of stream) {
		if (signal?.aborted) return;
		if (chunk.type === 'message_start') {
			currentUsage.input_tokens = chunk.message.usage.input_tokens;
			currentUsage.output_tokens = chunk.message.usage.output_tokens;
			onUpdate({}, currentUsage);
		} else if (chunk.type === 'message_delta') {
			// Anthropic provides cumulative usage in delta
			if (chunk.usage) {
				currentUsage.output_tokens = chunk.usage.output_tokens;
				onUpdate({}, currentUsage);
				console.debug("[Anthropic] Updated usage:", currentUsage);
			}
		} else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
			accumulatedText += chunk.delta.text;

			const jsonStart = accumulatedText.indexOf('{');
			if (jsonStart !== -1) {
				const jsonPart = accumulatedText.substring(jsonStart);
				const partial = tryParsePartialJson(jsonPart, candidateCount);
				if (partial) {
					const key = getPartialStreamKey(partial);
					if (key !== lastPartialKey) {
						lastPartialKey = key;
						onUpdate(partial, currentUsage);
					}
				}
			}
		}
	}

	if (!signal?.aborted && accumulatedText.trim()) {
		try {
			const final = parseJsonFromText<AiResponse>(accumulatedText);
			onUpdate(final, currentUsage);
		} catch (e) {
			console.warn("[Anthropic] Final JSON parse failed:", e);
		}
	}
}

// Main Translation Router
export async function translateText(
	text: string,
	sourceLang: string,
	targetLang: string,
	styles: Record<string, number>,
	model: AiModel = "gemini-1.5-flash",
	styleMeta: Record<string, { name: string; prompt?: string }> = {},
	candidateCount: number = 3,
	options: {
		provider?: AiProvider | null;
		apiKeys?: Record<string, string>;
		explanationLang?: string;
		signal?: AbortSignal;
		jsonMode?: boolean;
	} = {},
): Promise<AiResponse> {
	const userPrompt = buildUserPrompt(text, sourceLang, targetLang, styles, styleMeta);
	const systemPrompt = buildSystemPrompt(
		options.explanationLang || "日本語",
		candidateCount,
	);
	const provider = options.provider ?? getProviderForModel(model) ?? undefined;
	const jsonMode = options.jsonMode !== false;

	let response: AiResponse;

	if (provider === "gemini" || model.startsWith("gemini")) {
		response = await callGemini(
			model,
			userPrompt,
			systemPrompt,
			options.apiKeys?.google?.trim() || options.apiKeys?.gemini?.trim(),
		);
	} else if (provider === "openai" || model.startsWith("gpt") || model.startsWith("o3")) {
		response = await callOpenAI(
			model,
			userPrompt,
			systemPrompt,
			options.apiKeys?.openai?.trim(),
			options.signal,
			jsonMode,
		);
	} else if (provider === "groq") {
		response = await callGroqDirect(
			model,
			userPrompt,
			systemPrompt,
			options.apiKeys?.groq?.trim(),
			options.signal,
			jsonMode,
		);
	} else if (provider === "cerebras") {
		try {
			response = await callCerebrasDirect(
				model,
				userPrompt,
				systemPrompt,
				options.apiKeys?.cerebras?.trim(),
				options.signal,
				jsonMode,
			);
		} catch (err) {
			if (jsonMode && shouldRetryWithoutJson(err)) {
				response = await callCerebrasDirect(
					model,
					userPrompt,
					systemPrompt,
					options.apiKeys?.cerebras?.trim(),
					options.signal,
					false,
				);
			} else {
				throw err;
			}
		}
	} else if (provider === "anthropic" || model.startsWith("claude")) {
		response = await callAnthropic(
			model,
			userPrompt,
			systemPrompt,
			options.apiKeys?.anthropic?.trim(),
			options.signal,
		);
	} else {
		throw new Error(`Unsupported model: ${model}`);
	}

	// Add IDs
	response.candidates = response.candidates.map((c, i) => ({ ...c, id: i + 1 }));
	return response;
}
