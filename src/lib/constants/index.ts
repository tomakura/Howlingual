// Application constants for Howlingual

import type { ModelOption } from "$lib/types";

// App version
export const APP_VERSION = "1.0";

// Default shortcut
export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+H";

// History limits
export const MAX_HISTORY_ITEMS = 50;

// Available AI models
export const AVAILABLE_MODELS: ModelOption[] = [
	// OpenAI
	{ label: "GPT-5.2", value: "gpt-5.2", provider: "openai" },
	{ label: "GPT-5.2 Pro", value: "gpt-5.2-pro", provider: "openai" },
	{ label: "GPT-5.1", value: "gpt-5.1", provider: "openai" },
	{ label: "GPT-5-Mini", value: "gpt-5-mini", provider: "openai" },
	{ label: "GPT-5-Nano", value: "gpt-5-nano", provider: "openai" },
	{ label: "GPT-4.1", value: "gpt-4.1", provider: "openai" },
	{ label: "GPT-4.1-Mini", value: "gpt-4.1-mini", provider: "openai" },
	{ label: "GPT-4.1-Nano", value: "gpt-4.1-nano", provider: "openai" },
	{ label: "o3-pro", value: "o3-pro", provider: "openai" },
	// Google Gemini
	{ label: "Gemini 2.5 Pro", value: "gemini-2.5-pro", provider: "gemini" },
	{ label: "Gemini 2.5 Flash", value: "gemini-2.5-flash", provider: "gemini" },
	{ label: "Gemini 2.5 Flash-Lite", value: "gemini-2.5-flash-lite", provider: "gemini" },
	{ label: "Gemini 3 Pro", value: "gemini-3-pro", provider: "gemini" },
	{ label: "Gemini 3 Flash", value: "gemini-3-flash", provider: "gemini" },
	// Anthropic Claude
	{ label: "Claude Opus 4.5", value: "claude-opus-4.5", provider: "anthropic" },
	{ label: "Claude Sonnet 4.5", value: "claude-sonnet-4.5", provider: "anthropic" },
	{ label: "Claude Haiku 4.5", value: "claude-haiku-4.5", provider: "anthropic" },
];

// Supported languages
export const SUPPORTED_LANGUAGES = [
	"英語",
	"日本語",
	"中国語",
	"韓国語",
	"フランス語",
	"ドイツ語",
	"スペイン語",
] as const;

// Auto-detect label
export const AUTO_DETECT_LABEL = "自動検出";

// Settings tab order
export const SETTINGS_TAB_ORDER = [
	"appearance",
	"translation",
	"system",
	"api",
	"styles",
	"about",
] as const;

// Default API keys (empty)
export const DEFAULT_API_KEYS = {
	gemini: "",
	openai: "",
	anthropic: "",
};

// Default tech metrics
export const DEFAULT_TECH_METRICS = {
	time: 0,
	waitTime: 0,
	genTime: 0,
	model: "",
	inputTokens: 0,
	outputTokens: 0,
	tokensPerSec: 0,
	isReal: false,
	firstTokenReceived: false,
};

// Default translations (empty placeholders)
export const DEFAULT_TRANSLATIONS = [
	{ id: 1, text: "", reason: "" },
	{ id: 2, text: "", reason: "" },
	{ id: 3, text: "", reason: "" },
];

// Animation durations (ms)
export const ANIMATION_DURATIONS = {
	copyFeedback: 1500,
	replaceFeedback: 1500,
	sparkle: 1000,
	historyAnim: 1000,
	settingsAnim: 1000,
	speakAnim: 1200,
	copyAnim: 600,
	starPop: 600,
};

// Scroll thresholds
export const SCROLL_THRESHOLDS = {
	autoScrollNearBottom: 50,
	scrollUpDisable: 10,
	scrollUpDisableCompact: 3,
	scrollDownEnable: 5,
	scrollDownEnableCompact: 2,
	isAtBottom: 20,
};

// Text length thresholds for font size adjustment
export const TEXT_LENGTH_THRESHOLDS = {
	japanese: 90,
	english: 200,
};

// Language detection minimum characters
export const LANGUAGE_DETECTION_MIN_CHARS = 5;

// Textarea max heights
export const TEXTAREA_MAX_HEIGHTS = {
	compact: 120,
	main: 200,
};

// Local storage keys
export const STORAGE_KEYS = {
	settings: "howlingual_settings",
	customStyles: "howlingual_custom_styles",
	history: "howlingual_history",
	favorites: "howlingual_favorites",
	showTechInfo: "howlingual_showTechInfo",
	lastResult: "howlingual_last_result",
};

// Debounce delays (ms)
export const DEBOUNCE_DELAYS = {
	syncSharedState: 150,
	pendingTextPoll: 100,
	pendingTextTimeout: 3000,
};

// TTS language codes
export const TTS_LANGUAGE_CODES: Record<string, string> = {
	"日本語": "ja-JP",
	"英語": "en-US",
	"中国語": "zh-CN",
	"韓国語": "ko-KR",
	"フランス語": "fr-FR",
	"ドイツ語": "de-DE",
	"スペイン語": "es-ES",
};
