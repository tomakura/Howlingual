// Simple i18n system for Howlingual

export type AppLanguage = "ja" | "en" | "zh" | "ko";

interface Translations {
	// Header
	settings: string;
	history: string;

	// Language Selection
	autoDetect: string;
	detecting: string;

	// Translation UI
	inputPlaceholder: string;
	translating: string;
	translate: string;
	scrollToTop: string;
	copy: string;
	speak: string;
	stop: string;

	// Explanation
	explanation: string;

	// Settings
	settingsTitle: string;
	tabGeneral: string;
	tabApiKeys: string;
	tabStyles: string;
	styleName: string;
	stylePrompt: string;
	addStyle: string;
	resetStyles: string;
	confirmReset: string;
	delete: string;
	aiModel: string;
	openaiApiKey: string;
	geminiApiKey: string;
	anthropicApiKey: string;
	translationCount: string;
	defaultTargetLang: string;
	theme: string;
	themeDark: string;
	themeLight: string;
	appLanguage: string;
	save: string;
	close: string;

	// Styles
	polite: string;
	business: string;
	casual: string;
	catchy: string;
	childFriendly: string;
	email: string;
	concise: string;
}

const translations: Record<AppLanguage, Translations> = {
	ja: {
		settings: "設定",
		history: "履歴",
		autoDetect: "自動検出",
		detecting: "検出中...",
		inputPlaceholder: "テキストを入力または選択...",
		translating: "翻訳中･･･",
		translate: "翻訳",
		scrollToTop: "上に戻る",
		copy: "コピー",
		speak: "読み上げ",
		stop: "停止",
		explanation: "解説",
		settingsTitle: "設定",
		tabGeneral: "一般",
		tabApiKeys: "APIキー",
		tabStyles: "文体",
		styleName: "文体名",
		stylePrompt: "プロンプト",
		addStyle: "追加",
		resetStyles: "初期状態に戻す",
		confirmReset: "本当に文体を初期状態に戻しますか？",
		delete: "削除",
		aiModel: "AIモデル",
		openaiApiKey: "OpenAI API Key",
		geminiApiKey: "Gemini API Key",
		anthropicApiKey: "Anthropic API Key",
		translationCount: "翻訳案の数",
		defaultTargetLang: "デフォルト翻訳先言語",
		theme: "テーマ",
		themeDark: "ダーク",
		themeLight: "ライト",
		appLanguage: "アプリ言語",
		save: "保存",
		close: "閉じる",
		polite: "丁寧",
		business: "ビジネス",
		casual: "カジュアル",
		catchy: "キャッチー",
		childFriendly: "子ども向け",
		email: "メール",
		concise: "簡潔",
	},
	en: {
		settings: "Settings",
		history: "History",
		autoDetect: "Auto-detect",
		detecting: "Detecting...",
		inputPlaceholder: "Enter or select text...",
		translating: "Translating...",
		translate: "Translate",
		scrollToTop: "Back to top",
		copy: "Copy",
		speak: "Speak",
		stop: "Stop",
		explanation: "Explanation",
		settingsTitle: "Settings",
		tabGeneral: "General",
		tabApiKeys: "API Keys",
		tabStyles: "Styles",
		styleName: "Style Name",
		stylePrompt: "Prompt",
		addStyle: "Add",
		resetStyles: "Reset to Default",
		confirmReset: "Are you sure you want to reset styles?",
		delete: "Delete",
		aiModel: "AI Model",
		openaiApiKey: "OpenAI API Key",
		geminiApiKey: "Gemini API Key",
		anthropicApiKey: "Anthropic API Key",
		translationCount: "Number of translations",
		defaultTargetLang: "Default target language",
		theme: "Theme",
		themeDark: "Dark",
		themeLight: "Light",
		appLanguage: "App Language",
		save: "Save",
		close: "Close",
		polite: "Polite",
		business: "Business",
		casual: "Casual",
		catchy: "Catchy",
		childFriendly: "Kid-friendly",
		email: "Email",
		concise: "Concise",
	},
	zh: {
		settings: "设置",
		history: "历史",
		autoDetect: "自动检测",
		detecting: "检测中...",
		inputPlaceholder: "输入或选择文本...",
		translating: "翻译中...",
		translate: "翻译",
		scrollToTop: "返回顶部",
		copy: "复制",
		speak: "朗读",
		stop: "停止",
		explanation: "解说",
		settingsTitle: "设置",
		tabGeneral: "常规",
		tabApiKeys: "API密钥",
		tabStyles: "风格",
		styleName: "风格名称",
		stylePrompt: "提示词",
		addStyle: "添加",
		resetStyles: "恢复默认",
		confirmReset: "确定要重置风格吗？",
		delete: "删除",
		aiModel: "AI模型",
		openaiApiKey: "OpenAI API Key",
		geminiApiKey: "Gemini API Key",
		anthropicApiKey: "Anthropic API Key",
		translationCount: "翻译方案数量",
		defaultTargetLang: "默认目标语言",
		theme: "主题",
		themeDark: "深色",
		themeLight: "浅色",
		appLanguage: "应用语言",
		save: "保存",
		close: "关闭",
		polite: "礼貌",
		business: "商务",
		casual: "休闲",
		catchy: "吸引眼球",
		childFriendly: "儿童友好",
		email: "邮件",
		concise: "简洁",
	},
	ko: {
		settings: "설정",
		history: "기록",
		autoDetect: "자동 감지",
		detecting: "감지 중...",
		inputPlaceholder: "텍스트를 입력하거나 선택...",
		translating: "번역 중...",
		translate: "번역",
		scrollToTop: "맨 위로",
		copy: "복사",
		speak: "읽기",
		stop: "정지",
		explanation: "설명",
		settingsTitle: "설정",
		tabGeneral: "일반",
		tabApiKeys: "API 키",
		tabStyles: "문체",
		styleName: "문체 이름",
		stylePrompt: "프롬프트",
		addStyle: "추가",
		resetStyles: "초기화",
		confirmReset: "문체 설정을 초기화하시겠습니까?",
		delete: "삭제",
		aiModel: "AI 모델",
		openaiApiKey: "OpenAI API Key",
		geminiApiKey: "Gemini API Key",
		anthropicApiKey: "Anthropic API Key",
		translationCount: "번역 제안 수",
		defaultTargetLang: "기본 대상 언어",
		theme: "테마",
		themeDark: "다크",
		themeLight: "라이트",
		appLanguage: "앱 언어",
		save: "저장",
		close: "닫기",
		polite: "정중",
		business: "비즈니스",
		casual: "캐주얼",
		catchy: "캐치",
		childFriendly: "어린이용",
		email: "이메일",
		concise: "간결",
	},
};

export function t(lang: AppLanguage, key: keyof Translations): string {
	return translations[lang]?.[key] ?? translations.ja[key] ?? key;
}

// Get the full language name for prompts
export function getLanguageName(code: AppLanguage): string {
	const names: Record<AppLanguage, string> = {
		ja: "日本語",
		en: "English",
		zh: "中文",
		ko: "한국어",
	};
	return names[code];
}

// Style name mapping for localization
const styleNameMap: Record<string, keyof Translations> = {
	"丁寧": "polite",
	"ビジネス": "business",
	"カジュアル": "casual",
	"キャッチー": "catchy",
	"子ども向け": "childFriendly",
	"メール": "email",
	"簡潔": "concise",
};

export function getStyleName(lang: AppLanguage, styleKey: string): string {
	const key = styleNameMap[styleKey];
	if (key) {
		return translations[lang]?.[key] ?? styleKey;
	}
	return styleKey;
}

// Target language names localized
export function getTargetLanguageName(lang: AppLanguage, targetLang: string): string {
	const langNames: Record<AppLanguage, Record<string, string>> = {
		ja: {
			"日本語": "日本語", "英語": "英語", "中国語": "中国語", "韓国語": "韓国語",
			"フランス語": "フランス語", "ドイツ語": "ドイツ語", "スペイン語": "スペイン語"
		},
		en: {
			"日本語": "Japanese", "英語": "English", "中国語": "Chinese", "韓国語": "Korean",
			"フランス語": "French", "ドイツ語": "German", "スペイン語": "Spanish"
		},
		zh: {
			"日本語": "日语", "英語": "英语", "中国語": "中文", "韓国語": "韩语",
			"フランス語": "法语", "ドイツ語": "德语", "スペイン語": "西班牙语"
		},
		ko: {
			"日本語": "일본어", "英語": "영어", "中国語": "중국어", "韓国語": "한국어",
			"フランス語": "프랑스어", "ドイツ語": "독일어", "スペイン語": "스페인어"
		}
	};
	return langNames[lang]?.[targetLang] ?? targetLang;
}

export default translations;

