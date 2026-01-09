import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

// Environment variables
const ENV = import.meta.env;

// Initialize clients
const genAI = ENV.VITE_GOOGLE_GENERATIVE_AI_API_KEY ? new GoogleGenerativeAI(ENV.VITE_GOOGLE_GENERATIVE_AI_API_KEY) : null;
const openai = ENV.VITE_OPENAI_API_KEY ? new OpenAI({ apiKey: ENV.VITE_OPENAI_API_KEY, dangerouslyAllowBrowser: true }) : null;
const anthropic = ENV.VITE_ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ENV.VITE_ANTHROPIC_API_KEY, dangerouslyAllowBrowser: true }) : null;

export type AiModel = "gemini-1.5-flash" | "gpt-4o" | "gpt-4o-mini" | "claude-3-5-sonnet-20240620";

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

// Build system prompt with configurable explanation language
function buildSystemPrompt(explanationLang: string = "日本語"): string {
	return `
あなたはプロの翻訳者です。
ユーザーから提供された原文を、指定された言語へ翻訳してください。

[翻訳のルール]
1. **厳密に3つの翻訳案**を作成すること。
   - 1つ目: 文脈を考慮した、最も最適で自然な翻訳。
   - 2つ目・3つ目: ニュアンスや表現を変えたバリエーション。
2. **detected_source_language**: 原文の言語を判定し、${explanationLang}で出力すること。
3. 各翻訳案の「reason」と「detailed_explanation」は**${explanationLang}で**書くこと。
4. **detailed_explanation**: 重要な単語や文法ポイントを3つ程度ピックアップし、${explanationLang}で詳しく解説すること。
5. 出力は必ず以下のJSON形式のみで行うこと。

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
const SYSTEM_PROMPT = buildSystemPrompt("日本語");

// Helper to construct user prompt
function buildUserPrompt(text: string, sourceLang: string, targetLang: string, styles: Record<string, number>, stylePrompts: Record<string, string> = {}) {
	const activeStyles = Object.entries(styles)
		.filter(([_, level]) => level > 0)
		.map(([style, level]) => {
			const prompt = stylePrompts[style] ? ` (${stylePrompts[style]})` : "";
			return `${style}${prompt} (強度: ${level === 2 ? "強" : "弱"})`;
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
async function callGemini(prompt: string): Promise<AiResponse> {
	if (!genAI) throw new Error("Gemini API Key missing");

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

	const model = genAI.getGenerativeModel({
		model: "gemini-1.5-flash",
		systemInstruction: SYSTEM_PROMPT,
		generationConfig: {
			responseMimeType: "application/json",
			responseSchema: schema as any
		}
	});

	const result = await model.generateContent(prompt);
	return JSON.parse(result.response.text());
}

// OpenAI Implementation
async function callOpenAI(modelName: string, prompt: string): Promise<AiResponse> {
	if (!openai) throw new Error("OpenAI API Key missing");

	const completion = await openai.chat.completions.create({
		model: modelName,
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: prompt }
		],
		response_format: { type: "json_object" },
		// @ts-ignore - reasoning_effort might not be in the current SDK types yet
		reasoning_effort: "low"
	});

	const content = completion.choices[0].message.content;
	if (!content) throw new Error("No content from OpenAI");

	// OpenAI doesn't enforce schema as strictly, so we validate/parse carefully
	// Assuming the prompt guidance is enough for reliable JSON structure
	const parsed = JSON.parse(content);

	// Normalize if necessary (e.g. if root object keys differ slightly, though prompt asks for specific format)
	// For robustness, we could enforce a schema with Zod, but sticking to simple JSON parse for now.
	return parsed as AiResponse;
}

// Anthropic Implementation
async function callAnthropic(modelName: string, prompt: string): Promise<AiResponse> {
	if (!anthropic) throw new Error("Anthropic API Key missing");

	// Anthropic doesn't support JSON mode natively like OpenAI/Gemini yet in the same way,
	// so we append "Output JSON only" instruction excessively.
	const msg = await anthropic.messages.create({
		model: modelName,
		max_tokens: 1024,
		system: SYSTEM_PROMPT + "\n\nOutput strictly valid JSON.",
		messages: [{ role: "user", content: prompt }]
	});

	const contentBlock = msg.content[0];
	if (contentBlock.type !== 'text') throw new Error("Unexpected Anthropic response type");

	// Simple JSON extraction in case of preamble
	const jsonMatch = contentBlock.text.match(/\{[\s\S]*\}/);
	if (!jsonMatch) throw new Error("Failed to parse JSON from Anthropic response");

	return JSON.parse(jsonMatch[0]) as AiResponse;
}

// Helper to safely parse partial JSON with auto-closing attempts
function tryParsePartialJson(jsonStr: string): Partial<AiResponse> | null {
	// 0. Pre-process: remove trailing comma if present, as it breaks JSON.parse
	const trimmed = jsonStr.trim().replace(/,$/, "");

	// 1. Try naive parse
	try {
		return JSON.parse(trimmed);
	} catch (e) {
		// Continue to repair strategies
	}

	// 2. Try closing open structures
	// This is a heuristic approach.

	const closingSequences = [
		// Try closing string and then various nested levels
		'"}]}}', // Deepest: inside explanation string
		'"}]}',   // Inside candidate reason/text string
		'" }',    // General string close
		'}}',     // Close objects
		']}',     // Close array and object
		'}]}',    // Close object in array and object
		'"}]}}',
		'"}',
		'"]}',
		'"]}}',
		'"}',
		']',
		'}'
	];

	for (const seq of closingSequences) {
		try {
			return JSON.parse(trimmed + seq);
		} catch (e) {
			continue;
		}
	}

	return null;
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
	stylePrompts: Record<string, string> = {}
): Promise<void> {
	const userPrompt = buildUserPrompt(text, sourceLang, targetLang, styles, stylePrompts);
	const systemPrompt = buildSystemPrompt(explanationLang);

	if (model.startsWith("gemini")) {
		await streamGemini(userPrompt, onUpdate, systemPrompt);
	} else if (model.startsWith("gpt") || model.startsWith("o3")) {
		await streamOpenAI(model, userPrompt, onUpdate, systemPrompt);
	} else if (model.startsWith("claude")) {
		await streamAnthropic(model, userPrompt, onUpdate, systemPrompt);
	} else {
		throw new Error(`Unsupported model: ${model}`);
	}
}

// Gemini Streaming
async function streamGemini(prompt: string, onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void, systemPrompt: string) {
	if (!genAI) throw new Error("Gemini API Key missing");
	// Check schema definition from previous code... assuming it's available or re-defined here
	// For brevity re-using the logic conceptually.

	// Note: Gemini's generateContentStream with responseSchema might buffer significantly.
	// We use the model definition from before.
	const schema = {
		type: SchemaType.OBJECT,
		properties: {
			detected_source_language: { type: SchemaType.STRING },
			candidates: {
				type: SchemaType.ARRAY,
				items: {
					type: SchemaType.OBJECT,
					properties: {
						text: { type: SchemaType.STRING },
						reason: { type: SchemaType.STRING }
					}
				}
			}
		},
		required: ["detected_source_language", "candidates"]
	} as const;

	const model = genAI.getGenerativeModel({
		model: "gemini-1.5-flash",
		systemInstruction: SYSTEM_PROMPT,
		generationConfig: {
			responseMimeType: "application/json",
			responseSchema: schema as any
		}
	});

	const result = await model.generateContentStream(prompt);

	let accumulatedText = "";

	for await (const chunk of result.stream) {
		const chunkText = chunk.text();
		// console.log("Gemini Stream Chunk:", chunkText);
		accumulatedText += chunkText;

		const partial = tryParsePartialJson(accumulatedText);
		if (partial) {
			onUpdate(partial);
		}
	}
	// Final safe parse to ensure everything is correct
	try {
		const final = JSON.parse(accumulatedText);
		const response = await result.response;
		const usage = response.usageMetadata ? {
			input_tokens: response.usageMetadata.promptTokenCount,
			output_tokens: response.usageMetadata.candidatesTokenCount
		} : undefined;
		if (usage) console.log("[Gemini] Token Usage:", usage);

		onUpdate(final, usage);
	} catch (e) {
		console.warn("Gemini final parse/usage error:", e);
	}
}

// OpenAI Streaming
async function streamOpenAI(modelName: string, prompt: string, onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void, systemPrompt: string) {
	if (!openai) throw new Error("OpenAI API Key missing");

	const stream = await openai.chat.completions.create({
		model: modelName,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: prompt }
		],
		response_format: { type: "json_object" },
		stream: true,
		// @ts-ignore
		reasoning_effort: "low",
		// @ts-ignore
		stream_options: { include_usage: true }
	});

	let accumulatedText = "";
	for await (const chunk of stream) {
		const content = chunk.choices[0]?.delta?.content || "";

		if (chunk.usage) {
			onUpdate(tryParsePartialJson(accumulatedText) || {}, {
				input_tokens: chunk.usage.prompt_tokens,
				output_tokens: chunk.usage.completion_tokens
			});
			console.log("[OpenAI] Token Usage:", chunk.usage);
		}

		if (content) {
			// console.log("OpenAI Stream Chunk:", content);
			accumulatedText += content;
			const partial = tryParsePartialJson(accumulatedText);
			if (partial) {
				onUpdate(partial);
			}
		}
	}
	// Final safe parse (User requested "complete version" check)
	// Even though OpenAI streams deltas, accumulatedText IS the complete version at this point.
	try {
		if (accumulatedText.trim()) {
			const final = JSON.parse(accumulatedText);
			console.log("[OpenAI] Final Full JSON parsed successfully.");
			// Usage is already handled via chunk.usage in the loop (final chunk usually has it)
			onUpdate(final);
		}
	} catch (e) {
		console.warn("[OpenAI] Final JSON parse failed:", e);
	}
}

// Anthropic Streaming
async function streamAnthropic(modelName: string, prompt: string, onUpdate: (data: Partial<AiResponse>, usage?: UsageMetadata) => void, systemPrompt: string) {
	if (!anthropic) throw new Error("Anthropic API Key missing");

	const stream = await anthropic.messages.create({
		model: modelName,
		max_tokens: 1024,
		system: systemPrompt + "\n\nOutput strictly valid JSON.",
		messages: [{ role: "user", content: prompt }],
		stream: true
	});

	let accumulatedText = "";
	let currentUsage: UsageMetadata = { input_tokens: 0, output_tokens: 0 };

	for await (const chunk of stream) {
		if (chunk.type === 'message_start') {
			currentUsage.input_tokens = chunk.message.usage.input_tokens;
			currentUsage.output_tokens = chunk.message.usage.output_tokens;
			onUpdate({}, currentUsage);
		} else if (chunk.type === 'message_delta') {
			// Anthropic provides cumulative usage in delta
			// Anthropic provides cumulative usage in delta
			if (chunk.usage) {
				currentUsage.output_tokens = chunk.usage.output_tokens;
				onUpdate({}, currentUsage);
				console.log("[Anthropic] Updated Usage:", currentUsage);
			}
		} else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
			accumulatedText += chunk.delta.text;
			// console.log("Anthropic Stream Chunk:", chunk.delta.text);

			const jsonStart = accumulatedText.indexOf('{');
			if (jsonStart !== -1) {
				const jsonPart = accumulatedText.substring(jsonStart);
				const partial = tryParsePartialJson(jsonPart);
				if (partial) {
					onUpdate(partial, currentUsage);
				}
			}
		}
	}
}

// Main Translation Router
export async function translateText(
	text: string,
	sourceLang: string,
	targetLang: string,
	styles: Record<string, number>,
	model: AiModel = "gemini-1.5-flash"
): Promise<AiResponse> {
	const userPrompt = buildUserPrompt(text, sourceLang, targetLang, styles);

	let response: AiResponse;

	if (model.startsWith("gemini")) {
		response = await callGemini(userPrompt);
	} else if (model.startsWith("gpt")) {
		response = await callOpenAI(model, userPrompt);
	} else if (model.startsWith("claude")) {
		response = await callAnthropic(model, userPrompt);
	} else {
		throw new Error(`Unsupported model: ${model}`);
	}

	// Add IDs
	response.candidates = response.candidates.map((c, i) => ({ ...c, id: i + 1 }));
	return response;
}


