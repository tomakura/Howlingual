import { type AiProvider, STREAMING_MODELS_BY_PROVIDER } from "./ai_models";

export type ExecutionMode = "stream" | "non_stream";
export type ExecutionReason =
	| "streaming_disabled"
	| "provider_stream_unsupported"
	| "model_unsupported"
	| "provider_unknown"
	| "json_stream_unsupported";

type ProviderCaps = {
	stream: boolean;
	jsonStream: boolean;
	jsonNonStream: boolean;
};

const PROVIDER_CAPS: Record<AiProvider, ProviderCaps> = {
	openai: { stream: true, jsonStream: true, jsonNonStream: true },
	groq: { stream: true, jsonStream: true, jsonNonStream: true },
	cerebras: { stream: true, jsonStream: false, jsonNonStream: true },
	gemini: { stream: true, jsonStream: true, jsonNonStream: true },
	anthropic: { stream: true, jsonStream: false, jsonNonStream: false },
};

function getProviderCaps(provider?: AiProvider): ProviderCaps | null {
	if (!provider) return null;
	return PROVIDER_CAPS[provider] ?? null;
}

export function isStreamingModelSupported(
	provider?: AiProvider,
	model?: string,
): boolean {
	if (!provider || !model) return true;
	const models = STREAMING_MODELS_BY_PROVIDER[provider] || [];
	return models.includes(model);
}

export function getExecutionPlan(params: {
	provider?: AiProvider;
	model?: string;
	streamingDisplay: boolean;
}) {
	const { provider, model, streamingDisplay } = params;
	const caps = getProviderCaps(provider);

	if (!caps) {
		return {
			mode: streamingDisplay ? "stream" : "non_stream",
			jsonMode: false,
			reason: "provider_unknown" as const,
		};
	}

	if (!streamingDisplay) {
		return {
			mode: "non_stream" as const,
			jsonMode: caps.jsonNonStream,
			reason: "streaming_disabled" as const,
		};
	}

	if (!caps.stream) {
		return {
			mode: "non_stream" as const,
			jsonMode: caps.jsonNonStream,
			reason: "provider_stream_unsupported" as const,
		};
	}

	if (provider && model) {
		if (!isStreamingModelSupported(provider, model)) {
			return {
				mode: "non_stream" as const,
				jsonMode: caps.jsonNonStream,
				reason: "model_unsupported" as const,
			};
		}
	}

	if (!caps.jsonStream) {
		return {
			mode: "stream" as const,
			jsonMode: false,
			reason: "json_stream_unsupported" as const,
		};
	}

	return {
		mode: "stream" as const,
		jsonMode: caps.jsonStream,
	};
}
