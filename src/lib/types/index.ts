// Type definitions for Howlingual

import type { AppLanguage } from "$lib/i18n";
import type { AiModel as AiModelType } from "$lib/ai_service";

// Re-export types from ai_service for backward compatibility
export type {
	AiModel,
	TranslationResult,
	UsageMetadata,
	AiResponse,
} from "$lib/ai_service";

// AI Provider types
export type AiProvider = "openai" | "gemini" | "anthropic";

export interface ModelOption {
	label: string;
	value: string;
	provider: AiProvider;
}

export interface DetailedExplanation {
	points: { term: string; explanation: string }[];
}

// Style types
export interface StyleDefinition {
	id: string;
	name: string;
	prompt: string;
	isDefault?: boolean;
}

export type StyleLevels = Record<string, number>;

// Settings types
export interface ApiKeys {
	gemini: string;
	openai: string;
	anthropic: string;
}

export interface AppSettings {
	model: AiModelType;
	apiKeys: ApiKeys;
	defaultTargetLang: string;
	theme: "dark" | "light";
	appLanguage: AppLanguage;
	allowRewrite: boolean;
	quickShortcut: string;
	autoRunQuick: boolean;
	autoStartEnabled: boolean;
	startMinimized: boolean;
}

// History types
export interface HistoryItem {
	id: string;
	timestamp: number;
	sourceText: string;
	sourceLang: string;
	targetLang: string;
	translations: { text: string; reason: string }[];
	detailedExplanation: DetailedExplanation | null;
	styleLevels: StyleLevels;
	isFavorite?: boolean;
}

// Tech metrics types
export interface TechMetrics {
	time: number;
	waitTime: number;
	genTime: number;
	model: string;
	inputTokens: number;
	outputTokens: number;
	tokensPerSec: number;
	isReal: boolean;
	firstTokenReceived: boolean;
}

// UI State types
export type SettingsTab =
	| "appearance"
	| "translation"
	| "system"
	| "api"
	| "styles"
	| "about";

export type HistoryTab = "recent" | "favorites";

// Language types
export const SUPPORTED_LANGUAGES = [
	"英語",
	"日本語",
	"中国語",
	"韓国語",
	"フランス語",
	"ドイツ語",
	"スペイン語",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const AUTO_DETECT_LABEL = "自動検出" as const;
