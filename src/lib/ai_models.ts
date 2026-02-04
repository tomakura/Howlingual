export type AiProvider = "openai" | "gemini" | "anthropic" | "groq" | "cerebras";

export type AiModelEntry = {
	label: string;
	value: string;
	provider: AiProvider;
};

export const AI_MODELS: AiModelEntry[] = [
	// OpenAI
	{ label: "GPT-5.2", value: "gpt-5.2", provider: "openai" },
	{
		label: "GPT-5.2 Chat (Latest)",
		value: "gpt-5.2-chat-latest",
		provider: "openai",
	},
	{ label: "GPT-5.1", value: "gpt-5.1", provider: "openai" },
	{
		label: "GPT-5.1 Chat (Latest)",
		value: "gpt-5.1-chat-latest",
		provider: "openai",
	},
	{ label: "GPT-5", value: "gpt-5", provider: "openai" },
	{
		label: "GPT-5 Chat (Latest)",
		value: "gpt-5-chat-latest",
		provider: "openai",
	},
	{ label: "GPT-5 Mini", value: "gpt-5-mini", provider: "openai" },
	{ label: "GPT-5 Nano", value: "gpt-5-nano", provider: "openai" },
	{ label: "GPT-4.1", value: "gpt-4.1", provider: "openai" },
	{ label: "GPT-4.1 Mini", value: "gpt-4.1-mini", provider: "openai" },
	{ label: "GPT-4.1 Nano", value: "gpt-4.1-nano", provider: "openai" },
	{ label: "GPT-4o", value: "gpt-4o", provider: "openai" },
	{ label: "GPT-4o Mini", value: "gpt-4o-mini", provider: "openai" },
	{ label: "o3", value: "o3", provider: "openai" },
	{ label: "o3-mini", value: "o3-mini", provider: "openai" },
	{ label: "o1", value: "o1", provider: "openai" },
	{ label: "o1-mini", value: "o1-mini", provider: "openai" },
	// Google Gemini
	{ label: "Gemini 2.5 Pro", value: "gemini-2.5-pro", provider: "gemini" },
	{ label: "Gemini 2.5 Flash", value: "gemini-2.5-flash", provider: "gemini" },
	{
		label: "Gemini 2.5 Flash-Lite",
		value: "gemini-2.5-flash-lite",
		provider: "gemini",
	},
	{
		label: "Gemini 3 Pro Preview",
		value: "gemini-3-pro-preview",
		provider: "gemini",
	},
	{
		label: "Gemini 3 Flash Preview",
		value: "gemini-3-flash-preview",
		provider: "gemini",
	},
	// Anthropic Claude
	{
		label: "Claude Opus 4.1",
		value: "claude-opus-4-1-20250805",
		provider: "anthropic",
	},
	{
		label: "Claude Opus 4",
		value: "claude-opus-4-20250514",
		provider: "anthropic",
	},
	{
		label: "Claude Sonnet 4",
		value: "claude-sonnet-4-20250514",
		provider: "anthropic",
	},
	{
		label: "Claude Sonnet 3.7",
		value: "claude-3-7-sonnet-20250219",
		provider: "anthropic",
	},
	{
		label: "Claude Sonnet 3.5",
		value: "claude-3-5-sonnet-20241022",
		provider: "anthropic",
	},
	{
		label: "Claude Haiku 3.5",
		value: "claude-3-5-haiku-20241022",
		provider: "anthropic",
	},
	{
		label: "Claude Haiku 3",
		value: "claude-3-haiku-20240307",
		provider: "anthropic",
	},
	// Groq (OpenAI-compatible)
	{
		label: "Llama 4 Maverick 17B",
		value: "meta-llama/llama-4-maverick-17b-128e-instruct",
		provider: "groq",
	},
	{
		label: "Llama 4 Scout 17B",
		value: "meta-llama/llama-4-scout-17b-16e-instruct",
		provider: "groq",
	},
	{
		label: "Llama Guard 4 12B",
		value: "meta-llama/llama-guard-4-12b",
		provider: "groq",
	},
	{
		label: "Llama 3.3 70B Versatile",
		value: "llama-3.3-70b-versatile",
		provider: "groq",
	},
	{
		label: "Llama 3.1 8B Instant",
		value: "llama-3.1-8b-instant",
		provider: "groq",
	},
	{
		label: "GPT-OSS 120B",
		value: "openai/gpt-oss-120b",
		provider: "groq",
	},
	{
		label: "GPT-OSS 20B",
		value: "openai/gpt-oss-20b",
		provider: "groq",
	},
	{
		label: "Kimi K2 Instruct 0905",
		value: "moonshotai/kimi-k2-instruct-0905",
		provider: "groq",
	},
	{
		label: "Qwen 3 32B",
		value: "qwen/qwen3-32b",
		provider: "groq",
	},
	// Cerebras (OpenAI-compatible)
	{
		label: "Llama 3.3 70B",
		value: "llama-3.3-70b",
		provider: "cerebras",
	},
	{
		label: "Llama 3.1 8B",
		value: "llama3.1-8b",
		provider: "cerebras",
	},
	{
		label: "GPT-OSS 120B",
		value: "gpt-oss-120b",
		provider: "cerebras",
	},
	{
		label: "Qwen 3 32B",
		value: "qwen-3-32b",
		provider: "cerebras",
	},
	{
		label: "Qwen 3 235B Instruct (Preview)",
		value: "qwen-3-235b-a22b-instruct-2507",
		provider: "cerebras",
	},
	{
		label: "Z.ai GLM 4.7",
		value: "zai-glm-4.7",
		provider: "cerebras",
	},
];

export const DEFAULT_MODELS_BY_PROVIDER: Record<AiProvider, string> = {
	openai: "gpt-5-mini",
	gemini: "gemini-2.5-flash",
	anthropic: "claude-sonnet-4-20250514",
	groq: "llama-3.3-70b-versatile",
	cerebras: "qwen-3-235b-a22b-instruct-2507",
};

export const STREAMING_MODELS_BY_PROVIDER: Record<AiProvider, string[]> = {
	groq: [
		"meta-llama/llama-4-maverick-17b-128e-instruct",
		"meta-llama/llama-4-scout-17b-16e-instruct",
		"llama-3.3-70b-versatile",
		"llama-3.1-8b-instant",
		"openai/gpt-oss-120b",
		"openai/gpt-oss-20b",
		"moonshotai/kimi-k2-instruct-0905",
		"qwen/qwen3-32b",
	],
	cerebras: [
		"llama-3.3-70b",
		"llama3.1-8b",
		"gpt-oss-120b",
		"qwen-3-32b",
		"qwen-3-235b-a22b-instruct-2507",
		"zai-glm-4.7",
	],
	openai: [
		"gpt-5.2",
		"gpt-5.2-chat-latest",
		"gpt-5.1",
		"gpt-5.1-chat-latest",
		"gpt-5",
		"gpt-5-chat-latest",
		"gpt-5-mini",
		"gpt-5-nano",
		"gpt-4.1",
		"gpt-4.1-mini",
		"gpt-4.1-nano",
		"gpt-4o",
		"gpt-4o-mini",
		"o3",
		"o3-mini",
		"o1",
		"o1-mini",
	],
	gemini: [
		"gemini-2.5-pro",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
		"gemini-3-pro-preview",
		"gemini-3-flash-preview",
	],
	anthropic: [
		"claude-opus-4-1-20250805",
		"claude-opus-4-20250514",
		"claude-sonnet-4-20250514",
		"claude-3-7-sonnet-20250219",
		"claude-3-5-sonnet-20241022",
		"claude-3-5-haiku-20241022",
		"claude-3-haiku-20240307",
	],
};

const MODEL_PROVIDER_MAP = new Map<string, AiProvider>(
	AI_MODELS.map((model) => [model.value, model.provider]),
);

export function isAiProvider(value: unknown): value is AiProvider {
	return (
		value === "openai" ||
		value === "gemini" ||
		value === "anthropic" ||
		value === "groq" ||
		value === "cerebras"
	);
}

export function getModelEntry(model?: string | null): AiModelEntry | null {
	if (!model) return null;
	return AI_MODELS.find((entry) => entry.value === model) ?? null;
}

export function getProviderForModel(model?: string | null): AiProvider | null {
	if (!model) return null;
	const mapped = MODEL_PROVIDER_MAP.get(model);
	if (mapped) return mapped;
	if (model.startsWith("gemini")) return "gemini";
	if (model.startsWith("claude")) return "anthropic";
	if (model.startsWith("gpt") || model.startsWith("o3") || model.startsWith("o1")) {
		return "openai";
	}
	return null;
}

export function getDefaultModelForProvider(provider: AiProvider): string | null {
	return (
		DEFAULT_MODELS_BY_PROVIDER[provider] ??
		AI_MODELS.find((model) => model.provider === provider)?.value ??
		null
	);
}

export function getModelsForProvider(provider: AiProvider): AiModelEntry[] {
	return AI_MODELS.filter((model) => model.provider === provider);
}
