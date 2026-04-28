export type AiProvider = "openai" | "gemini" | "anthropic" | "groq" | "cerebras";

export type ModelSpeed = "fast" | "balanced" | "deliberate";
export type ModelQuality = "good" | "best";
export type StreamingExperience = "great" | "normal" | "delayed";

export type AiModelEntry = {
	label: string;
	value: string;
	provider: AiProvider;
	speed: ModelSpeed;
	quality: ModelQuality;
	reasoning: boolean;
	recommended: boolean;
	streamingExperience: StreamingExperience;
};

export const DEFAULT_MODELS_BY_PROVIDER: Record<AiProvider, string> = {
	openai: "gpt-5.4-mini",
	gemini: "gemini-2.5-flash",
	anthropic: "claude-sonnet-4-20250514",
	groq: "openai/gpt-oss-20b",
	cerebras: "gpt-oss-120b",
};

function inferReasoning(value: string): boolean {
	return (
		value.startsWith("gpt-5.5") ||
		value.startsWith("o1") ||
		value.startsWith("o3") ||
		value.startsWith("o4")
	);
}

function inferSpeed(value: string, provider: AiProvider, reasoning: boolean): ModelSpeed {
	if (reasoning) return "deliberate";
	if (
		value.includes("nano") ||
		value.includes("mini") ||
		value.includes("flash-lite") ||
		value.includes("flash") ||
		value.includes("instant") ||
		value.includes("8b") ||
		value.includes("scout")
	) {
		return "fast";
	}
	if (
		value.includes("opus") ||
		value.includes("pro") ||
		value.includes("120b") ||
		value.includes("235b")
	) {
		return "deliberate";
	}
	if (provider === "anthropic" && value.includes("sonnet")) return "balanced";
	return "balanced";
}

function inferQuality(value: string, provider: AiProvider): ModelQuality {
	if (
		value.includes("opus") ||
		value.includes("sonnet-4") ||
		value.includes("gpt-5.5") ||
		value.includes("gpt-5.4") ||
		value.includes("gpt-5.2") ||
		value.includes("gemini-3.1-pro") ||
		value.includes("gemini-2.5-pro") ||
		value.includes("120b") ||
		value.includes("235b") ||
		value.startsWith("o1") ||
		value.startsWith("o3") ||
		value.startsWith("o4")
	) {
		return "best";
	}
	if (provider === "anthropic" && value.includes("sonnet")) return "best";
	return "good";
}

function inferStreamingExperience(
	value: string,
	speed: ModelSpeed,
	reasoning: boolean,
): StreamingExperience {
	if (reasoning) return "delayed";
	if (value.includes("flash") || value.includes("mini") || value.includes("instant")) {
		return "great";
	}
	if (speed === "deliberate") return "delayed";
	return "normal";
}

function buildModel(
	label: string,
	value: string,
	provider: AiProvider,
	overrides: Partial<
		Pick<
			AiModelEntry,
			"speed" | "quality" | "reasoning" | "recommended" | "streamingExperience"
		>
	> = {},
): AiModelEntry {
	const reasoning = overrides.reasoning ?? inferReasoning(value);
	const speed = overrides.speed ?? inferSpeed(value, provider, reasoning);
	return {
		label,
		value,
		provider,
		speed,
		quality: overrides.quality ?? inferQuality(value, provider),
		reasoning,
		recommended:
			overrides.recommended ?? value === DEFAULT_MODELS_BY_PROVIDER[provider],
		streamingExperience:
			overrides.streamingExperience ??
			inferStreamingExperience(value, speed, reasoning),
	};
}

export const AI_MODELS: AiModelEntry[] = [
	buildModel("GPT-5.5", "gpt-5.5", "openai", {
		reasoning: true,
		speed: "balanced",
		quality: "best",
		streamingExperience: "normal",
	}),
	buildModel("GPT-5.4 Pro", "gpt-5.4-pro", "openai", {
		reasoning: true,
		speed: "deliberate",
		quality: "best",
		streamingExperience: "delayed",
	}),
	buildModel("GPT-5.4", "gpt-5.4", "openai", { quality: "best" }),
	buildModel("GPT-5.4 Mini", "gpt-5.4-mini", "openai", {
		speed: "fast",
		quality: "good",
		streamingExperience: "great",
	}),
	buildModel("GPT-5.4 Nano", "gpt-5.4-nano", "openai", {
		speed: "fast",
		quality: "good",
		streamingExperience: "great",
	}),
	buildModel("GPT-5.3 Chat (Latest)", "gpt-5.3-chat-latest", "openai", {
		speed: "balanced",
		quality: "best",
	}),
	buildModel("GPT-5.2", "gpt-5.2", "openai", { quality: "best" }),
	buildModel("GPT-5.2 Chat (Latest)", "gpt-5.2-chat-latest", "openai", {
		quality: "best",
	}),
	buildModel("GPT-5.1", "gpt-5.1", "openai"),
	buildModel("GPT-5.1 Chat (Latest)", "gpt-5.1-chat-latest", "openai"),
	buildModel("GPT-5", "gpt-5", "openai"),
	buildModel("GPT-5 Chat (Latest)", "gpt-5-chat-latest", "openai", {
		quality: "best",
	}),
	buildModel("GPT-5 Mini", "gpt-5-mini", "openai", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("GPT-5 Nano", "gpt-5-nano", "openai", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("GPT-4.1", "gpt-4.1", "openai"),
	buildModel("GPT-4.1 Mini", "gpt-4.1-mini", "openai", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("GPT-4.1 Nano", "gpt-4.1-nano", "openai", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("GPT-4o", "gpt-4o", "openai"),
	buildModel("GPT-4o Mini", "gpt-4o-mini", "openai", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("o4-mini", "o4-mini", "openai", {
		reasoning: true,
		speed: "deliberate",
		quality: "best",
		streamingExperience: "delayed",
	}),
	buildModel("o3", "o3", "openai", {
		reasoning: true,
		speed: "deliberate",
		quality: "best",
		streamingExperience: "delayed",
	}),
	buildModel("o3-mini", "o3-mini", "openai", {
		reasoning: true,
		speed: "deliberate",
		quality: "best",
		streamingExperience: "delayed",
	}),
	buildModel("o1", "o1", "openai", {
		reasoning: true,
		speed: "deliberate",
		quality: "best",
		streamingExperience: "delayed",
	}),
	buildModel("Gemini 3.1 Pro Preview", "gemini-3.1-pro-preview", "gemini", {
		speed: "balanced",
		quality: "best",
	}),
	buildModel("Gemini 3 Flash Preview", "gemini-3-flash-preview", "gemini", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("Gemini 3.1 Flash-Lite Preview", "gemini-3.1-flash-lite-preview", "gemini", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("Gemini 2.5 Pro", "gemini-2.5-pro", "gemini", {
		speed: "balanced",
		quality: "best",
	}),
	buildModel("Gemini 2.5 Flash", "gemini-2.5-flash", "gemini", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("Gemini 2.5 Flash-Lite", "gemini-2.5-flash-lite", "gemini", {
		speed: "fast",
		quality: "good",
		streamingExperience: "great",
	}),
	buildModel("Gemini 2.0 Flash", "gemini-2.0-flash", "gemini", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("Gemini 2.0 Flash-Lite", "gemini-2.0-flash-lite", "gemini", {
		speed: "fast",
		quality: "good",
		streamingExperience: "great",
	}),
	buildModel("Claude Opus 4.1", "claude-opus-4-1-20250805", "anthropic", {
		speed: "deliberate",
		quality: "best",
		streamingExperience: "delayed",
	}),
	buildModel("Claude Opus 4", "claude-opus-4-20250514", "anthropic", {
		speed: "deliberate",
		quality: "best",
		streamingExperience: "delayed",
	}),
	buildModel("Claude Sonnet 4", "claude-sonnet-4-20250514", "anthropic", {
		speed: "balanced",
		quality: "best",
	}),
	buildModel("Claude Sonnet 3.7", "claude-3-7-sonnet-20250219", "anthropic", {
		speed: "balanced",
		quality: "best",
	}),
	buildModel("Claude Sonnet 3.5", "claude-3-5-sonnet-20241022", "anthropic"),
	buildModel("Claude Haiku 3.5", "claude-3-5-haiku-20241022", "anthropic", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("GPT-OSS 120B", "openai/gpt-oss-120b", "groq", {
		speed: "balanced",
		quality: "best",
	}),
	buildModel("GPT-OSS 20B", "openai/gpt-oss-20b", "groq", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("Kimi K2 0905", "moonshotai/kimi-k2-instruct-0905", "groq", {
		speed: "balanced",
	}),
	buildModel("Qwen3 32B", "qwen/qwen3-32b", "groq", {
		speed: "balanced",
	}),
	buildModel(
		"Llama 4 Scout 17B",
		"meta-llama/llama-4-scout-17b-16e-instruct",
		"groq",
		{ speed: "fast", streamingExperience: "great" },
	),
	buildModel("Llama 3.3 70B Versatile", "llama-3.3-70b-versatile", "groq"),
	buildModel("Llama 3.1 8B Instant", "llama-3.1-8b-instant", "groq", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("Llama 3.1 8B", "llama3.1-8b", "cerebras", {
		speed: "fast",
		streamingExperience: "great",
	}),
	buildModel("GPT-OSS 120B", "gpt-oss-120b", "cerebras", {
		speed: "balanced",
		quality: "best",
	}),
	buildModel(
		"Qwen 3 235B Instruct (Preview)",
		"qwen-3-235b-a22b-instruct-2507",
		"cerebras",
		{ speed: "deliberate", quality: "best", streamingExperience: "delayed" },
	),
	buildModel("Z.ai GLM 4.7", "zai-glm-4.7", "cerebras", {
		speed: "balanced",
	}),
];

export const STREAMING_MODELS_BY_PROVIDER: Record<AiProvider, string[]> = {
	groq: [
		"openai/gpt-oss-120b",
		"openai/gpt-oss-20b",
		"moonshotai/kimi-k2-instruct-0905",
		"qwen/qwen3-32b",
		"meta-llama/llama-4-maverick-17b-128e-instruct",
		"meta-llama/llama-4-scout-17b-16e-instruct",
		"llama-3.3-70b-versatile",
		"llama-3.1-8b-instant",
	],
	cerebras: [
		"llama3.1-8b",
		"gpt-oss-120b",
		"qwen-3-235b-a22b-instruct-2507",
		"zai-glm-4.7",
	],
	openai: [
		"gpt-5.5",
		"gpt-5.4",
		"gpt-5.4-mini",
		"gpt-5.4-nano",
		"gpt-5.3-chat-latest",
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
		"o4-mini",
		"o3",
		"o3-mini",
		"o1",
	],
	gemini: [
		"gemini-3.1-pro-preview",
		"gemini-3-flash-preview",
		"gemini-3.1-flash-lite-preview",
		"gemini-2.5-pro",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
		"gemini-2.0-flash",
		"gemini-2.0-flash-lite",
	],
	anthropic: [
		"claude-opus-4-1-20250805",
		"claude-opus-4-20250514",
		"claude-sonnet-4-20250514",
		"claude-3-7-sonnet-20250219",
		"claude-3-5-sonnet-20241022",
		"claude-3-5-haiku-20241022",
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
	if (
		model.startsWith("gpt") ||
		model.startsWith("o4") ||
		model.startsWith("o3") ||
		model.startsWith("o1")
	) {
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

export function getRecommendedModelForProvider(provider: AiProvider): AiModelEntry | null {
	const model = DEFAULT_MODELS_BY_PROVIDER[provider];
	return getModelEntry(model);
}

export function getModelsForProvider(provider: AiProvider): AiModelEntry[] {
	return AI_MODELS.filter((model) => model.provider === provider);
}
