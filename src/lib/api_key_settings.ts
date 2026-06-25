import type { AiProvider } from "./ai_models";
import { t, type AppLanguage } from "./i18n";

export type ApiKeyPresence = "unset" | "session" | "stored";
export type ApiKeyStatus = Record<AiProvider, ApiKeyPresence>;
export type ApiKeyDrafts = Record<AiProvider, string>;

export function createEmptyApiKeyDrafts(): ApiKeyDrafts {
	return {
		gemini: "",
		openai: "",
		anthropic: "",
		groq: "",
		cerebras: "",
	};
}

export function createEmptyApiKeyStatus(): ApiKeyStatus {
	return {
		gemini: "unset",
		openai: "unset",
		anthropic: "unset",
		groq: "unset",
		cerebras: "unset",
	};
}

export function getApiKeyLabel(
	appLanguage: AppLanguage,
	provider: AiProvider,
) {
	switch (provider) {
		case "openai":
			return t(appLanguage, "openaiApiKey");
		case "gemini":
			return t(appLanguage, "geminiApiKey");
		case "anthropic":
			return t(appLanguage, "anthropicApiKey");
		case "groq":
			return t(appLanguage, "groqApiKey");
		case "cerebras":
			return t(appLanguage, "cerebrasApiKey");
	}
}

export function getApiKeyPlaceholder(
	appLanguage: AppLanguage,
	provider: AiProvider,
	status: ApiKeyPresence,
) {
	if (status === "stored") return t(appLanguage, "apiKeyStored");
	if (status === "session") return t(appLanguage, "apiKeySession");
	switch (provider) {
		case "gemini":
			return "AIza...";
		case "anthropic":
			return "sk-ant-...";
		case "groq":
		case "cerebras":
		case "openai":
		default:
			return "sk-...";
	}
}

export function getApiKeyStatusLabel(
	appLanguage: AppLanguage,
	status: ApiKeyPresence,
) {
	switch (status) {
		case "stored":
			return t(appLanguage, "apiKeyStored");
		case "session":
			return t(appLanguage, "apiKeySession");
		case "unset":
		default:
			return t(appLanguage, "apiKeyUnset");
	}
}
