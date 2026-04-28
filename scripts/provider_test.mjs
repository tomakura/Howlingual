import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

const loadEnvFromFile = (filePath) => {
	if (!fs.existsSync(filePath)) return;
	const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
	for (const line of lines) {
		if (!line || line.trim().startsWith("#")) continue;
		const idx = line.indexOf("=");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (key && !(key in process.env)) {
			process.env[key] = value;
		}
	}
};

loadEnvFromFile(path.join(process.cwd(), ".env"));

const args = new Set(process.argv.slice(2));
const getArgValue = (name, fallback) => {
	const idx = process.argv.indexOf(name);
	if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
	return fallback;
};

const maxTokensArg = getArgValue("--max-tokens", "");
const maxTokens = maxTokensArg ? Number(maxTokensArg) : null;
const outDir = getArgValue("--out", "reports");
const prompt = getArgValue(
	"--prompt",
	"Translate to Japanese in one short sentence: 'The quick brown fox jumps over the lazy dog.'",
);
const anthropicDisplayName = getArgValue(
	"--anthropic-display-name",
	"Claude Sonnet 4.6",
);
const anthropicModelOverride = getArgValue("--anthropic-model-id", "");

const env = {
	OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
	GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
	ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
	GROQ_API_KEY: process.env.GROQ_API_KEY || "",
	CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY || "",
};

const now = new Date();
const timestamp = now
	.toISOString()
	.replace(/[:.]/g, "-")
	.replace("T", "_")
	.replace("Z", "");

const ensureDir = (dir) => {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const hrNow = () => Number(process.hrtime.bigint()) / 1e6;

async function resolveAnthropicModel() {
	if (anthropicModelOverride) return anthropicModelOverride;
	if (!env.ANTHROPIC_API_KEY) return "";
	const res = await fetch("https://api.anthropic.com/v1/models", {
		method: "GET",
		headers: {
			"x-api-key": env.ANTHROPIC_API_KEY,
			"anthropic-version": "2023-06-01",
		},
	});
	if (!res.ok) {
		throw new Error(`Anthropic models list failed: ${res.status} ${res.statusText}`);
	}
	const data = await res.json();
	const list = Array.isArray(data?.data) ? data.data : [];
	const target = anthropicDisplayName.toLowerCase();
	const matched = list.find((m) =>
		String(m.display_name || "").toLowerCase().includes(target),
	);
	return matched?.id || "";
}

async function runOpenAICompatible({
	name,
	baseURL,
	apiKey,
	model,
	useMaxCompletionTokens = false,
	temperature,
	stream = false,
}) {
	if (!apiKey) throw new Error(`${name} API key missing`);
	const client = new OpenAI({ apiKey, baseURL });
	const t0 = hrNow();
	const requestParams = {
		model,
		messages: [
			{ role: "system", content: "You are a concise translation assistant." },
			{ role: "user", content: prompt },
		],
	};
	if (typeof temperature === "number") {
		requestParams.temperature = temperature;
	}
	if (typeof maxTokens === "number" && Number.isFinite(maxTokens)) {
		if (useMaxCompletionTokens) {
			requestParams.max_completion_tokens = maxTokens;
		} else {
			requestParams.max_tokens = maxTokens;
		}
	}
	if (!stream) {
		const response = await client.chat.completions.create(requestParams);
		const t1 = hrNow();
		const text = response.choices?.[0]?.message?.content || "";
		return {
			model,
			ok: true,
			text,
			usage: response.usage || null,
			latency_ms: Math.round(t1 - t0),
		};
	}

	requestParams.stream = true;
	requestParams.stream_options = { include_usage: true };
	const streamResult = await client.chat.completions.create(requestParams);
	let text = "";
	let usage = null;
	for await (const chunk of streamResult) {
		const delta = chunk.choices?.[0]?.delta?.content || "";
		if (delta) text += delta;
		if (chunk.usage) usage = chunk.usage;
	}
	const t1 = hrNow();
	return {
		model,
		ok: true,
		text,
		usage,
		latency_ms: Math.round(t1 - t0),
	};
}

async function runProviderFetch({ name, url, apiKey, model }) {
	if (!apiKey) throw new Error(`${name} API key missing`);
	const t0 = hrNow();
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: "system", content: "You are a concise translation assistant." },
				{ role: "user", content: prompt },
			],
			temperature: 0.2,
			max_tokens: maxTokens ?? undefined,
		}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`${name} HTTP ${res.status}: ${text.slice(0, 200)}`);
	}
	const data = await res.json();
	const t1 = hrNow();
	const text = data?.choices?.[0]?.message?.content || "";
	return {
		model,
		ok: true,
		text,
		usage: data?.usage || null,
		latency_ms: Math.round(t1 - t0),
	};
}

async function runGemini({ model, apiKey, stream = false }) {
	if (!apiKey) throw new Error("Gemini API key missing");
	const genAI = new GoogleGenerativeAI(apiKey);
	const modelRef = genAI.getGenerativeModel({ model });
	const t0 = hrNow();
	if (!stream) {
		const result = await modelRef.generateContent({
			contents: [{ role: "user", parts: [{ text: prompt }] }],
			generationConfig: {
				temperature: 0.2,
			},
		});
		const t1 = hrNow();
		const text = result.response?.text?.() || "";
		return {
			model,
			ok: true,
			text,
			usage: result.response?.usageMetadata || null,
			latency_ms: Math.round(t1 - t0),
		};
	}

	// Stream
	// @ts-expect-error - SDK typing does not include AbortSignal yet
	const generationConfig = { temperature: 0.2 };
	if (typeof maxTokens === "number" && Number.isFinite(maxTokens)) {
		generationConfig.maxOutputTokens = maxTokens;
	}
	const result = await modelRef.generateContentStream({
		contents: [{ role: "user", parts: [{ text: prompt }] }],
		generationConfig,
	});
	let text = "";
	for await (const chunk of result.stream) {
		const chunkText = chunk.text?.() || "";
		if (chunkText) text += chunkText;
	}
	const response = await result.response;
	const t1 = hrNow();
	return {
		model,
		ok: true,
		text,
		usage: response?.usageMetadata || null,
		latency_ms: Math.round(t1 - t0),
	};
}

async function runAnthropic({ model, apiKey, stream = false }) {
	if (!apiKey) throw new Error("Anthropic API key missing");
	const client = new Anthropic({ apiKey });
	const t0 = hrNow();
	if (!stream) {
		const response = await client.messages.create({
			model,
			system: "You are a concise translation assistant.",
			messages: [{ role: "user", content: prompt }],
		});
		const t1 = hrNow();
		const textBlock = response.content?.find((c) => c.type === "text");
		const text = textBlock?.text || "";
		return {
			model,
			ok: true,
			text,
			usage: response.usage || null,
			latency_ms: Math.round(t1 - t0),
		};
	}

	const requestParams = {
		model,
		system: "You are a concise translation assistant.",
		messages: [{ role: "user", content: prompt }],
		stream: true,
	};
	if (typeof maxTokens === "number" && Number.isFinite(maxTokens)) {
		requestParams.max_tokens = maxTokens;
	}
	const streamResult = await client.messages.create({
		...requestParams,
	});
	let text = "";
	let usage = null;
	for await (const chunk of streamResult) {
		if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
			text += chunk.delta.text || "";
		}
		if (chunk.type === "message_delta" && chunk.usage) {
			usage = chunk.usage;
		}
		if (chunk.type === "message_start" && chunk.message?.usage) {
			usage = chunk.message.usage;
		}
	}
	const t1 = hrNow();
	return {
		model,
		ok: true,
		text,
		usage,
		latency_ms: Math.round(t1 - t0),
	};
}

async function main() {
	ensureDir(outDir);
	const report = {
		timestamp: now.toISOString(),
		prompt,
		max_tokens: maxTokens ?? undefined,
		env_keys_present: {
			openai: Boolean(env.OPENAI_API_KEY),
			gemini: Boolean(env.GEMINI_API_KEY),
			anthropic: Boolean(env.ANTHROPIC_API_KEY),
			groq: Boolean(env.GROQ_API_KEY),
			cerebras: Boolean(env.CEREBRAS_API_KEY),
		},
		results: {},
	};

	const anthropicModel = await resolveAnthropicModel().catch((err) => {
		report.results.anthropic = {
			model: "",
			ok: false,
			error: String(err),
		};
		return "";
	});

	const tasks = [
		{
			name: "openai",
			run: () =>
				runOpenAICompatible({
					name: "OpenAI",
					apiKey: env.OPENAI_API_KEY,
					model: "gpt-5-mini",
					useMaxCompletionTokens: true,
					temperature: undefined,
					stream: true,
				}),
		},
		{
			name: "gemini",
			run: () =>
				runGemini({
					apiKey: env.GEMINI_API_KEY,
					model: "gemini-3.1-flash-lite-preview",
					stream: true,
				}),
		},
		{
			name: "anthropic",
			run: () => {
				if (!anthropicModel) throw new Error("Anthropic model not resolved");
				return runAnthropic({
					apiKey: env.ANTHROPIC_API_KEY,
					model: anthropicModel,
					stream: true,
				});
			},
		},
		{
			name: "groq",
			run: () =>
				runProviderFetch({
					name: "Groq",
					apiKey: env.GROQ_API_KEY,
					url: "https://api.groq.com/openai/v1/chat/completions",
					model: "openai/gpt-oss-120b",
				}),
		},
		{
			name: "cerebras",
			run: () =>
				runProviderFetch({
					name: "Cerebras",
					apiKey: env.CEREBRAS_API_KEY,
					url: "https://api.cerebras.ai/v1/chat/completions",
					model: "qwen-3-235b-a22b-instruct-2507",
				}),
		},
	];

	for (const task of tasks) {
		try {
			const result = await task.run();
			report.results[task.name] = result;
		} catch (err) {
			report.results[task.name] = {
				model: task.name,
				ok: false,
				error: String(err),
			};
		}
	}

	const jsonPath = path.join(outDir, `provider_test_${timestamp}.json`);
	fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

	const lines = [];
	lines.push(`# Provider test report (${now.toISOString()})`);
	lines.push("");
	lines.push(`Prompt: ${prompt}`);
	lines.push(`Max tokens: ${maxTokens}`);
	lines.push("");
	for (const [name, result] of Object.entries(report.results)) {
		lines.push(`## ${name}`);
		if (result.ok) {
			lines.push(`Model: ${result.model}`);
			lines.push(`Latency (ms): ${result.latency_ms}`);
			lines.push(`Usage: ${JSON.stringify(result.usage)}`);
			lines.push(`Text: ${result.text}`);
		} else {
			lines.push(`Error: ${result.error}`);
		}
		lines.push("");
	}
	const mdPath = path.join(outDir, `provider_test_${timestamp}.md`);
	fs.writeFileSync(mdPath, lines.join("\n"), "utf8");

	console.log(`Report written: ${jsonPath}`);
	console.log(`Report written: ${mdPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
