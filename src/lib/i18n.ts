// Simple i18n system for Howlingual

export type AppLanguage = "ja" | "en" | "zh" | "ko";

interface Translations {
	// Header
	settings: string;
	history: string;
	openMain: string;

	// Language Selection
	autoDetect: string;
	detecting: string;
	detected: string;

	// Translation UI
	inputPlaceholder: string;
	translating: string;
	translate: string;
	scrollToTop: string;
	copy: string;
	speak: string;
	stop: string;
	replaceSelection: string;
	moreActions: string;
	startOCR: string;

	// Explanation
	explanation: string;

	// Settings
	settingsTitle: string;
	tabGeneral: string; // Deprecated but kept for safety if needed, or remove if fully refactored
	tabAppearance: string;
	tabTranslation: string;
	tabSystem: string;
	tabAi: string;
	tabStyles: string;
	tabAbout: string;
	styleName: string;
	stylePrompt: string;
	stylePromptHint: string;
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
	back: string;
	editStyle: string;
	cancel: string;
	allowRewrite: string;
	allowRewriteDescription: string;
	confirmDiscard: string;
	discard: string;
	aiTabDescription: string;
	showTechInfo: string;
	showTechInfoDesc: string;
	autoStart: string;
	autoStartDesc: string;
	startMinimized: string;
	startMinimizedDesc: string;
	quickShortcut: string;
	quickShortcutHint: string;
	applyShortcut: string;
	shortcutInvalid: string;

	// Styles
	polite: string;
	business: string;
	casual: string;
	catchy: string;
	childFriendly: string;
	email: string;
	concise: string;
	noHistory: string;
	noFavorites: string;
	clearHistory: string;
	tabRecent: string;
	tabFavorites: string;
	saveToFavorites: string;
	autoRunQuick: string;
	autoRunQuickDesc: string;
	ocrHint: string;
	ocrCancelHint: string;
	// Empty state
	emptyTitle: string;
	emptyDescription: string;
	emptyHintType: string;
	emptyHintPaste: string;
	emptyHintOcr: string;
}

const translations: Record<AppLanguage, Translations> = {
	ja: {
		settings: "設定",
		history: "履歴",
		openMain: "メインを開く",
		autoDetect: "自動検出",
		detecting: "検出中...",
		detected: "検出",
		inputPlaceholder: "テキストを入力または選択...",
		translating: "翻訳中･･･",
		translate: "翻訳",
		scrollToTop: "上に戻る",
		copy: "コピー",
		speak: "読み上げ",
		stop: "停止",
		replaceSelection: "選択文を置換",
		moreActions: "その他の操作",
		startOCR: "画面から文字を読み取る",
		explanation: "解説",
		settingsTitle: "設定",
		tabGeneral: "一般",
		tabAppearance: "表示",
		tabTranslation: "翻訳",
		tabSystem: "システム",
		tabAi: "AI",
		tabStyles: "文体一覧",
		tabAbout: "情報",
		styleName: "文体名",
		stylePrompt: "プロンプト",
		stylePromptHint: "AIへの指示を入力してください。（例：〜な口調で翻訳して、〜という用語を使って、など）",
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
		back: "戻る",
		editStyle: "文体を編集",
		cancel: "キャンセル",
		allowRewrite: "同一言語の翻訳(リライト)を許可",
		allowRewriteDescription: "オンにすると、翻訳元と翻訳先が同じ言語でも、AIによる言い換えとして翻訳を実行します。",
		confirmDiscard: "変更を破棄しますか？",
		discard: "破棄して戻る",
		aiTabDescription: "選択したAIプロバイダーのモデルが有効になります。",
		showTechInfo: "技術情報を表示",
		showTechInfoDesc: "翻訳時に処理時間やトークン数を表示します。",
		autoStart: "スタートアップで起動",
		autoStartDesc: "OS 起動時にアプリを自動で起動します",
		startMinimized: "起動時はメイン画面を最小化",
		startMinimizedDesc: "起動時にメイン画面を最小化して開始します",
		quickShortcut: "クイック起動ショートカット",
		quickShortcutHint: "例: CommandOrControl+Shift+H",
		applyShortcut: "適用",
		shortcutInvalid: "ショートカットが無効です",
		polite: "丁寧",
		business: "ビジネス",
		casual: "カジュアル",
		catchy: "キャッチー",
		childFriendly: "子ども向け",
		email: "メール",
		concise: "簡潔",
		noHistory: "履歴はありません",
		noFavorites: "保存した履歴はありません",
		clearHistory: "履歴を削除",
		tabRecent: "最近",
		tabFavorites: "保存済み",
		saveToFavorites: "保存",
		autoRunQuick: "クイック翻訳の自動実行",
		autoRunQuickDesc: "ショートカット呼出時に自動で翻訳を開始します",
		ocrHint: "翻訳する範囲を選択してください",
		ocrCancelHint: "Escキーでキャンセル",
		emptyTitle: "テキストを入力してください",
		emptyDescription: "AIが複数の翻訳候補と詳しい解説を提供します",
		emptyHintType: "テキストを直接入力",
		emptyHintPaste: "クリップボードから貼り付け",
		emptyHintOcr: "OCRで画面から読み取り",
	},
	en: {
		settings: "Settings",
		history: "History",
		openMain: "Open Main",
		autoDetect: "Auto-detect",
		detecting: "Detecting...",
		detected: "Detected",
		inputPlaceholder: "Enter or select text...",
		translating: "Translating...",
		translate: "Translate",
		scrollToTop: "Back to top",
		copy: "Copy",
		speak: "Speak",
		stop: "Stop",
		replaceSelection: "Replace selection",
		moreActions: "More actions",
		startOCR: "Extract Text (OCR)",
		explanation: "Explanation",
		settingsTitle: "Settings",
		tabGeneral: "General",
		tabAppearance: "Appearance",
		tabTranslation: "Translation",
		tabSystem: "System",
		tabAi: "AI",
		tabStyles: "Style List",
		tabAbout: "About",
		styleName: "Style Name",
		stylePrompt: "Prompt",
		stylePromptHint: "Please enter instructions for the AI. (e.g., Translate in a ~, use the term ~, etc.)",
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
		back: "Back",
		editStyle: "Edit Style",
		cancel: "Cancel",
		allowRewrite: "Allow rewrite (same language)",
		allowRewriteDescription: "Enable to perform AI rewriting even if source and target languages are the same.",
		confirmDiscard: "Discard changes?",
		discard: "Discard",
		aiTabDescription: "The model from the selected AI provider will be active.",
		showTechInfo: "Show Technical Info",
		showTechInfoDesc: "Display processing time and token count during translation.",
		autoStart: "Launch on startup",
		autoStartDesc: "Automatically launch the app when the OS starts.",
		startMinimized: "Start with main window minimized",
		startMinimizedDesc: "Minimize the main window on launch.",
		quickShortcut: "Quick Shortcut",
		quickShortcutHint: "Example: CommandOrControl+Shift+H",
		applyShortcut: "Apply",
		shortcutInvalid: "Invalid shortcut",
		polite: "Polite",
		business: "Business",
		casual: "Casual",
		catchy: "Catchy",
		childFriendly: "Kid-friendly",
		email: "Email",
		concise: "Concise",
		noHistory: "No history found",
		noFavorites: "No saved items",
		clearHistory: "Clear History",
		tabRecent: "Recent",
		tabFavorites: "Saved",
		saveToFavorites: "Save",
		autoRunQuick: "Auto-run Quick Translate",
		autoRunQuickDesc: "Automatically start translation when shortcut is pressed",
		ocrHint: "Select area to translate",
		ocrCancelHint: "Press Esc to cancel",
		emptyTitle: "Enter text to translate",
		emptyDescription: "AI will provide multiple translation options with detailed explanations",
		emptyHintType: "Type text directly",
		emptyHintPaste: "Paste from clipboard",
		emptyHintOcr: "OCR from screen",
	},
	zh: {
		settings: "设置",
		history: "历史",
		openMain: "打开主界面",
		autoDetect: "自动检测",
		detecting: "检测中...",
		detected: "检测",
		inputPlaceholder: "输入或选择文本...",
		translating: "翻译中...",
		translate: "翻译",
		scrollToTop: "返回顶部",
		copy: "复制",
		speak: "朗读",
		stop: "停止",
		replaceSelection: "替换所选",
		moreActions: "更多操作",
		startOCR: "屏幕文字识别 (OCR)",
		explanation: "解说",
		settingsTitle: "设置",
		tabGeneral: "常规",
		tabAppearance: "外观",
		tabTranslation: "翻译",
		tabSystem: "系统",
		tabAi: "AI",
		tabStyles: "风格",
		tabAbout: "关于",
		styleName: "风格名称",
		stylePrompt: "提示词",
		stylePromptHint: "请输入AI指令。（例如：用〜语气翻译，使用〜术语等）",
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
		back: "返回",
		editStyle: "编辑风格",
		cancel: "取消",
		allowRewrite: "允许重写（相同语言）",
		allowRewriteDescription: "如果禁用，当源语言和目标语言相同时，目标语言将自动切换。",
		confirmDiscard: "放弃更改？",
		discard: "丢弃",
		aiTabDescription: "所选AI提供商的模型将处于活动状态。",
		showTechInfo: "显示技术信息",
		showTechInfoDesc: "翻译时显示处理时间和令牌计数",
		autoStart: "开机自启",
		autoStartDesc: "系统启动时自动启动应用",
		startMinimized: "启动时最小化主窗口",
		startMinimizedDesc: "启动时将主窗口最小化显示",
		quickShortcut: "快捷键",
		quickShortcutHint: "例如: CommandOrControl+Shift+H",
		applyShortcut: "应用",
		shortcutInvalid: "快捷键无效",
		polite: "礼貌",
		business: "商务",
		casual: "休闲",
		catchy: "吸引眼球",
		childFriendly: "儿童友好",
		email: "邮件",
		concise: "简洁",
		noHistory: "暂无历史记录",
		noFavorites: "暂无已保存项目",
		clearHistory: "清空历史",
		tabRecent: "最近",
		tabFavorites: "已保存",
		saveToFavorites: "保存",
		autoRunQuick: "快速翻译自动执行",
		autoRunQuickDesc: "按快捷键时自动开始翻译",
		ocrHint: "请选择要翻译的区域",
		ocrCancelHint: "按 Esc 取消",
		emptyTitle: "请输入要翻译的文本",
		emptyDescription: "AI将提供多种翻译选项并附详细说明",
		emptyHintType: "直接输入文本",
		emptyHintPaste: "从剪贴板粘贴",
		emptyHintOcr: "通过OCR从屏幕读取",
	},
	ko: {
		settings: "설정",
		history: "기록",
		openMain: "메인 열기",
		autoDetect: "자동 감지",
		detecting: "감지 중...",
		detected: "감지",
		inputPlaceholder: "텍스트를 입력하거나 선택...",
		translating: "번역 중...",
		translate: "번역",
		scrollToTop: "맨 위로",
		copy: "복사",
		speak: "읽기",
		stop: "정지",
		replaceSelection: "선택 문장 바꾸기",
		moreActions: "추가 작업",
		startOCR: "화면 문자 인식 (OCR)",
		explanation: "설명",
		settingsTitle: "설정",
		tabGeneral: "일반",
		tabAppearance: "화면",
		tabTranslation: "번역",
		tabSystem: "시스템",
		tabAi: "AI",
		tabStyles: "문체",
		tabAbout: "정보",
		styleName: "문체 이름",
		stylePrompt: "프롬프트",
		stylePromptHint: "AI지침 입력 (예: ~ 말투로 번역, ~ 용어 사용 등)",
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
		back: "뒤로",
		editStyle: "문체 편집",
		cancel: "취소",
		allowRewrite: "동일 언어 번역(리라이트) 허용",
		allowRewriteDescription: "비활성화 시, 원본 언어와 대상 언어가 같으면 대상 언어가 자동으로 변경됩니다.",
		confirmDiscard: "변경 사항을 취소하시겠습니까?",
		discard: "취소하고 뒤로",
		aiTabDescription: "선택한 AI 제공업체의 모델이 활성화됩니다.",
		showTechInfo: "기술 정보 표시",
		showTechInfoDesc: "번역 시 처리 시간 및 토큰 수 표시",
		autoStart: "시작 프로그램 실행",
		autoStartDesc: "OS 시작 시 앱을 자동으로 실행합니다.",
		startMinimized: "시작 시 메인 창 최소화",
		startMinimizedDesc: "실행 시 메인 창을 최소화합니다.",
		quickShortcut: "단축키",
		quickShortcutHint: "예: CommandOrControl+Shift+H",
		applyShortcut: "적용",
		shortcutInvalid: "유효하지 않은 단축키",
		polite: "정중",
		business: "비즈니스",
		casual: "캐주얼",
		catchy: "캐치",
		childFriendly: "어린이용",
		email: "이메일",
		concise: "간결",
		noHistory: "기록이 없습니다",
		noFavorites: "저장된 항목이 없습니다",
		clearHistory: "기록 삭제",
		tabRecent: "최근",
		tabFavorites: "저장됨",
		saveToFavorites: "저장",
		autoRunQuick: "빠른 번역 자동 실행",
		autoRunQuickDesc: "단축키 호출 시 자동으로 번역을 시작합니다",
		ocrHint: "번역할 영역을 선택하세요",
		ocrCancelHint: "Esc를 눌러 취소",
		emptyTitle: "번역할 텍스트를 입력하세요",
		emptyDescription: "AI가 여러 번역 옵션과 자세한 설명을 제공합니다",
		emptyHintType: "텍스트 직접 입력",
		emptyHintPaste: "클립보드에서 붙여넣기",
		emptyHintOcr: "OCR로 화면에서 읽기",
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
