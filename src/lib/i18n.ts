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
	groqApiKey: string;
	cerebrasApiKey: string;
	translationCount: string;
	defaultTargetLang: string;
	theme: string;
	themeDark: string;
	themeLight: string;
	appLanguage: string;
	save: string;
	close: string;
	closeSettings: string;
	back: string;
	minimize: string;
	maximize: string;
	editStyle: string;
	cancel: string;
	allowRewrite: string;
	allowRewriteDescription: string;
	confirmDiscard: string;
	discard: string;
	aiTabDescription: string;
	apiOverview: string;
	apiOverviewDesc: string;
	openDocs: string;
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
	permissions: string;
	screenRecording: string;
	accessibility: string;
	granted: string;
	denied: string;
	grant: string;
	checking: string;
	openSystemSettings: string;
	quit: string;
	rememberApiKeys: string;
	rememberApiKeysDesc: string;
	apiKeyWarning: string;
	clipboardOps: string;
	clipboardOpsDesc: string;
	clipboardOpsWarning: string;
	clipboardOpsConfirmEnable: string;
	clipboardOpsConfirmReplace: string;
	clipboardOpsDisabled: string;
	replaceUnavailableLinux: string;
	ttsUnavailable: string;

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
	favoriteCurrentTranslation: string;
	toggleFavorite: string;
	deleteFavorite: string;
	moveUp: string;
	moveDown: string;
	autoRunQuick: string;
	autoRunQuickDesc: string;
	ocrHint: string;
	ocrCancelHint: string;
	ocrReading: string;
	// Empty state
	emptyTitle: string;
	emptyDescription: string;
	emptyHintType: string;
	emptyHintPaste: string;
	emptyHintOcr: string;
	clearText: string;
	pasteFromClipboard: string;
	stopTranslation: string;
	translationCountDesc: string;
	showMore: string;
	moreItems: string;
	showLess: string;
	minimizeWindow: string;
	maximizeWindow: string;
	closeWindow: string;
	weeklyUsageTrendLabel: string;
	ocrEngine: string;
	ocrHighAccuracy: string;
	ocrHighAccuracyDesc: string;
	ocrFast: string;
	ocrFastDesc: string;
	usageToday: string;
	usageTokensToday: string;
	usageWeeklyTrend: string;
	usageCountLabel: string;
	usageTokensLabel: string;
	waitLabel: string;
	generationLabel: string;
	totalLabel: string;
	inputLabel: string;
	outputLabel: string;
	usageReset: string;
	translationSending: string;
	translationWaitingModel: string;
	translationGenerating: string;
	translationStopped: string;
	usingModel: string;
	sourceEstimate: string;
	translationCandidates: string;
	modelFast: string;
	modelBalanced: string;
	modelDeliberate: string;
	modelGood: string;
	modelBest: string;
	modelRecommended: string;
	modelReasoningSlow: string;
	modelStreamingGreat: string;
	modelStreamingNormal: string;
	modelStreamingDelayed: string;
	apiKeyStored: string;
	apiKeySession: string;
	apiKeyUnset: string;
	providerReady: string;
	providerSetupNeeded: string;
	providerRecommendedModel: string;
	historyLoad: string;
	historyRetry: string;
	errorApiKeyMissing: string;
	errorQuota: string;
	errorModelUnavailable: string;
	errorRateLimit: string;
	errorActionFixKeys: string;
	errorActionOpenSettings: string;
	streamingFallbackNote: string;
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
		ocrEngine: "OCRエンジン",
		ocrHighAccuracy: "PaddleOCR (高精度)",
		ocrHighAccuracyDesc: "精度を最優先します。少し時間がかかる場合があります。",
		ocrFast: "Windows標準 (高速)",
		ocrFastDesc: "OS標準機能を使用します。非常に高速ですが、精度は劣る場合があります。",
		usageToday: "今日の使用回数",
		usageTokensToday: "今日のトークン",
		usageWeeklyTrend: "1週間の推移",
		usageCountLabel: "回数",
		usageTokensLabel: "トークン",
		waitLabel: "待機",
		generationLabel: "生成",
		totalLabel: "合計",
		inputLabel: "入力",
		outputLabel: "出力",
		usageReset: "0時更新",
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
		groqApiKey: "Groq API Key",
		cerebrasApiKey: "Cerebras API Key",
		translationCount: "翻訳案の数",
		defaultTargetLang: "デフォルト翻訳先言語",
		theme: "テーマ",
		themeDark: "ダーク",
		themeLight: "ライト",
		appLanguage: "アプリ言語",
		save: "保存",
		close: "閉じる",
		closeSettings: "設定を閉じる",
		back: "戻る",
		minimize: "最小化",
		maximize: "最大化",
		editStyle: "文体を編集",
		cancel: "キャンセル",
		allowRewrite: "同一言語の翻訳(リライト)を許可",
		allowRewriteDescription: "オンにすると、翻訳元と翻訳先が同じ言語でも、AIによる言い換えとして翻訳を実行します。",
		confirmDiscard: "変更を破棄しますか？",
		discard: "破棄して戻る",
		aiTabDescription: "選択したAIプロバイダーのモデルが有効になります。",
		apiOverview: "API概要",
		apiOverviewDesc: "選択中のプロバイダーの公式APIドキュメントを開きます。",
		openDocs: "ドキュメントを開く",
		showTechInfo: "技術情報を表示",
		showTechInfoDesc: "翻訳時に処理時間やトークン数を表示します。",
		autoStart: "スタートアップで起動",
		autoStartDesc: "OS 起動時にアプリを自動で起動します",
		startMinimized: "起動時はメイン画面を非表示",
		startMinimizedDesc: "起動時にメイン画面を非表示で開始します",
		quickShortcut: "クイック起動ショートカット",
		quickShortcutHint: "例: CommandOrControl+Shift+H",
		applyShortcut: "適用",
		shortcutInvalid: "ショートカットが無効です",
		permissions: "権限",
		screenRecording: "画面収録",
		accessibility: "アクセシビリティ",
		granted: "許可済み",
		denied: "未許可",
		grant: "許可する",
		checking: "確認中...",
		openSystemSettings: "設定を開く",
		quit: "終了",
		rememberApiKeys: "APIキーを保存する",
		rememberApiKeysDesc: "再起動後もAPIキーを保持します",
		apiKeyWarning: "APIキーは端末のローカルストレージに保存されます。共有PCではOFF推奨。",
		clipboardOps: "クリップボード操作",
		clipboardOpsDesc: "選択テキスト取得/置換のため、一時的にクリップボードを書き換えます",
		clipboardOpsWarning: "画像やファイルのクリップボード内容が失われる可能性があります",
		clipboardOpsConfirmEnable: "クリップボード操作を有効化しますか？画像やファイルが失われる可能性があります。",
		clipboardOpsConfirmReplace: "選択中のテキストを置換します。クリップボード内容が失われる可能性があります。続けますか？",
		clipboardOpsDisabled: "クリップボード操作が無効です",
		replaceUnavailableLinux: "Linuxでは選択文の置換は未対応です",
		ttsUnavailable: "この環境では読み上げが利用できません",
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
		favoriteCurrentTranslation: "現在の翻訳を保存",
		toggleFavorite: "保存状態を切り替える",
		deleteFavorite: "保存済み項目を削除",
		moveUp: "上へ移動",
		moveDown: "下へ移動",
		autoRunQuick: "クイック翻訳の自動実行",
		autoRunQuickDesc: "ショートカット呼出時に自動で翻訳を開始します",
		ocrHint: "翻訳する範囲を選択してください",
		ocrCancelHint: "Escキーでキャンセル",
		ocrReading: "文字を読み取り中...",
		emptyTitle: "テキストを入力してください",
		emptyDescription: "AIが複数の翻訳候補と詳しい解説を提供します",
		emptyHintType: "テキストを直接入力",
		emptyHintPaste: "クリップボードから貼り付け",
		emptyHintOcr: "OCRで画面から読み取り",
		clearText: "テキストをクリア",
		pasteFromClipboard: "クリップボードから貼り付け",
		stopTranslation: "翻訳を停止",
		translationCountDesc: "一度に生成する翻訳案の数です",
		showMore: "もっと見る",
		moreItems: "件",
		showLess: "折りたたむ",
		minimizeWindow: "最小化",
		maximizeWindow: "最大化",
		closeWindow: "閉じる",
		weeklyUsageTrendLabel: "1週間の使用状況",
		translationSending: "送信中...",
		translationWaitingModel: "モデル応答待ち...",
		translationGenerating: "生成中...",
		translationStopped: "停止済み",
		usingModel: "モデル",
		sourceEstimate: "ソース推定",
		translationCandidates: "候補数",
		modelFast: "速い",
		modelBalanced: "バランス",
		modelDeliberate: "考えてから返す",
		modelGood: "標準品質",
		modelBest: "高品質",
		modelRecommended: "おすすめ",
		modelReasoningSlow: "初速は遅めですが、品質を優先するモデルです。",
		modelStreamingGreat: "ストリーミング向き",
		modelStreamingNormal: "通常のストリーミング",
		modelStreamingDelayed: "初速は遅め",
		apiKeyStored: "保存済み",
		apiKeySession: "このセッションのみ",
		apiKeyUnset: "未設定",
		providerReady: "このプロバイダーはすぐ使えます。",
		providerSetupNeeded: "まず API キーを入れると使えるようになります。",
		providerRecommendedModel: "推奨モデル",
		historyLoad: "読み込む",
		historyRetry: "再翻訳",
		errorApiKeyMissing: "API キーが未設定です。AI タブから追加してください。",
		errorQuota: "利用上限または課金設定を確認してください。",
		errorModelUnavailable: "このモデルは現在利用できません。別のモデルに切り替えてください。",
		errorRateLimit: "リクエストが多すぎます。少し待って再試行してください。",
		errorActionFixKeys: "AI 設定を開く",
		errorActionOpenSettings: "設定を開く",
		streamingFallbackNote: "このモデルは一括表示寄りです。途中表示は控えめになります。",
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
		ocrEngine: "OCR Engine",
		ocrHighAccuracy: "PaddleOCR (High Accuracy)",
		ocrHighAccuracyDesc: "Prioritizes accuracy. May take slightly longer.",
		ocrFast: "Windows Standard (Fast)",
		ocrFastDesc: "Uses OS native feature. Very fast, but may be less accurate.",
		usageToday: "Today's usage",
		usageTokensToday: "Today's tokens",
		usageWeeklyTrend: "Weekly trend",
		usageCountLabel: "Count",
		usageTokensLabel: "Tokens",
		waitLabel: "Wait",
		generationLabel: "Gen",
		totalLabel: "Total",
		inputLabel: "In",
		outputLabel: "Out",
		usageReset: "Resets at 00:00",
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
		groqApiKey: "Groq API Key",
		cerebrasApiKey: "Cerebras API Key",
		translationCount: "Number of translations",
		defaultTargetLang: "Default target language",
		theme: "Theme",
		themeDark: "Dark",
		themeLight: "Light",
		appLanguage: "App Language",
		save: "Save",
		close: "Close",
		closeSettings: "Close settings",
		back: "Back",
		minimize: "Minimize",
		maximize: "Maximize",
		editStyle: "Edit Style",
		cancel: "Cancel",
		allowRewrite: "Allow rewrite (same language)",
		allowRewriteDescription: "Enable to perform AI rewriting even if source and target languages are the same.",
		confirmDiscard: "Discard changes?",
		discard: "Discard",
		aiTabDescription: "The model from the selected AI provider will be active.",
		apiOverview: "API Overview",
		apiOverviewDesc: "Open the official API docs for the selected provider.",
		openDocs: "Open docs",
		showTechInfo: "Show Technical Info",
		showTechInfoDesc: "Display processing time and token count during translation.",
		autoStart: "Launch on startup",
		autoStartDesc: "Automatically launch the app when the OS starts.",
		startMinimized: "Start with main window hidden",
		startMinimizedDesc: "Start with the main window hidden.",
		quickShortcut: "Quick Shortcut",
		quickShortcutHint: "Example: CommandOrControl+Shift+H",
		applyShortcut: "Apply",
		shortcutInvalid: "Invalid shortcut",
		permissions: "Permissions",
		screenRecording: "Screen Recording",
		accessibility: "Accessibility",
		granted: "Granted",
		denied: "Denied",
		grant: "Grant",
		checking: "Checking...",
		openSystemSettings: "Open Settings",
		quit: "Quit",
		rememberApiKeys: "Remember API keys",
		rememberApiKeysDesc: "Keep API keys after restart",
		apiKeyWarning: "API keys are stored in local storage. Turn off on shared machines.",
		clipboardOps: "Clipboard operations",
		clipboardOpsDesc: "Temporarily overwrites clipboard to capture/replace selected text",
		clipboardOpsWarning: "Images/files in the clipboard may be lost",
		clipboardOpsConfirmEnable: "Enable clipboard operations? Images/files in the clipboard may be lost.",
		clipboardOpsConfirmReplace: "Replace the selected text? Clipboard contents may be lost.",
		clipboardOpsDisabled: "Clipboard operations are disabled",
		replaceUnavailableLinux: "Replace selection is not supported on Linux",
		ttsUnavailable: "Text-to-speech is not available in this environment",
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
		favoriteCurrentTranslation: "Save current translation",
		toggleFavorite: "Toggle favorite",
		deleteFavorite: "Delete saved item",
		moveUp: "Move up",
		moveDown: "Move down",
		autoRunQuick: "Auto-run Quick Translate",
		autoRunQuickDesc: "Automatically start translation when shortcut is pressed",
		ocrHint: "Select area to translate",
		ocrCancelHint: "Press Esc to cancel",
		ocrReading: "Reading text...",
		emptyTitle: "Enter text to translate",
		emptyDescription: "AI will provide multiple translation options with detailed explanations",
		emptyHintType: "Type text directly",
		emptyHintPaste: "Paste from clipboard",
		emptyHintOcr: "OCR from screen",
		clearText: "Clear text",
		pasteFromClipboard: "Paste from clipboard",
		stopTranslation: "Stop translation",
		translationCountDesc: "Number of translation candidates to generate at once",
		showMore: "Show more",
		moreItems: "items",
		showLess: "Show less",
		minimizeWindow: "Minimize",
		maximizeWindow: "Maximize",
		closeWindow: "Close",
		weeklyUsageTrendLabel: "Weekly usage trend",
		translationSending: "Sending...",
		translationWaitingModel: "Waiting for model...",
		translationGenerating: "Generating...",
		translationStopped: "Stopped",
		usingModel: "Model",
		sourceEstimate: "Source guess",
		translationCandidates: "Candidates",
		modelFast: "Fast",
		modelBalanced: "Balanced",
		modelDeliberate: "Thinks first",
		modelGood: "Standard quality",
		modelBest: "High quality",
		modelRecommended: "Recommended",
		modelReasoningSlow: "This reasoning model starts slower but usually gives better output.",
		modelStreamingGreat: "Great for streaming",
		modelStreamingNormal: "Normal streaming",
		modelStreamingDelayed: "Slower first token",
		apiKeyStored: "Stored",
		apiKeySession: "Session only",
		apiKeyUnset: "Unset",
		providerReady: "This provider is ready to use.",
		providerSetupNeeded: "Add an API key first to use this provider.",
		providerRecommendedModel: "Recommended model",
		historyLoad: "Load",
		historyRetry: "Retry",
		errorApiKeyMissing: "API key is missing. Add it from the AI tab.",
		errorQuota: "Check your quota or billing settings for this provider.",
		errorModelUnavailable: "This model is unavailable right now. Switch to another model.",
		errorRateLimit: "Too many requests. Wait a moment and try again.",
		errorActionFixKeys: "Open AI settings",
		errorActionOpenSettings: "Open Settings",
		streamingFallbackNote: "This model may feel closer to one-shot output than live streaming.",
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
		ocrEngine: "OCR引擎",
		ocrHighAccuracy: "PaddleOCR (高精度)",
		ocrHighAccuracyDesc: "优先考虑准确性。可能需要稍长时间。",
		ocrFast: "Windows标准 (快速)",
		ocrFastDesc: "使用系统原生功能。速度很快，但准确性可能较低。",
		usageToday: "今日使用次数",
		usageTokensToday: "今日代币",
		usageWeeklyTrend: "一周趋势",
		usageCountLabel: "次数",
		usageTokensLabel: "代币",
		waitLabel: "等待",
		generationLabel: "生成",
		totalLabel: "总计",
		inputLabel: "输入",
		outputLabel: "输出",
		usageReset: "0点更新",
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
		groqApiKey: "Groq API Key",
		cerebrasApiKey: "Cerebras API Key",
		translationCount: "翻译方案数量",
		defaultTargetLang: "默认目标语言",
		theme: "主题",
		themeDark: "深色",
		themeLight: "浅色",
		appLanguage: "应用语言",
		save: "保存",
		close: "关闭",
		closeSettings: "关闭设置",
		back: "返回",
		minimize: "最小化",
		maximize: "最大化",
		editStyle: "编辑风格",
		cancel: "取消",
		allowRewrite: "允许重写（相同语言）",
		allowRewriteDescription: "如果禁用，当源语言和目标语言相同时，目标语言将自动切换。",
		confirmDiscard: "放弃更改？",
		discard: "丢弃",
		aiTabDescription: "所选AI提供商的模型将处于活动状态。",
		apiOverview: "API 概览",
		apiOverviewDesc: "打开当前所选提供商的官方 API 文档。",
		openDocs: "打开文档",
		showTechInfo: "显示技术信息",
		showTechInfoDesc: "翻译时显示处理时间和令牌计数",
		autoStart: "开机自启",
		autoStartDesc: "系统启动时自动启动应用",
		startMinimized: "启动时隐藏主窗口",
		startMinimizedDesc: "启动时将主窗口隐藏",
		quickShortcut: "快捷键",
		quickShortcutHint: "例如: CommandOrControl+Shift+H",
		applyShortcut: "应用",
		shortcutInvalid: "快捷键无效",
		permissions: "权限",
		screenRecording: "屏幕录制",
		accessibility: "辅助功能",
		granted: "已授权",
		denied: "未授权",
		grant: "授权",
		checking: "检查中...",
		openSystemSettings: "打开设置",
		quit: "退出",
		rememberApiKeys: "保存 API 密钥",
		rememberApiKeysDesc: "重启后保留 API 密钥",
		apiKeyWarning: "API 密钥会保存在本地存储，共享设备建议关闭。",
		clipboardOps: "剪贴板操作",
		clipboardOpsDesc: "为获取/替换选中文本会临时改写剪贴板",
		clipboardOpsWarning: "剪贴板中的图片/文件可能会丢失",
		clipboardOpsConfirmEnable: "要启用剪贴板操作吗？剪贴板中的图片/文件可能会丢失。",
		clipboardOpsConfirmReplace: "要替换选中文本吗？剪贴板内容可能会丢失。",
		clipboardOpsDisabled: "剪贴板操作已禁用",
		replaceUnavailableLinux: "Linux 上不支持替换选中文本",
		ttsUnavailable: "此环境不支持朗读功能",
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
		favoriteCurrentTranslation: "保存当前翻译",
		toggleFavorite: "切换收藏状态",
		deleteFavorite: "删除已保存项目",
		moveUp: "上移",
		moveDown: "下移",
		autoRunQuick: "快速翻译自动执行",
		autoRunQuickDesc: "按快捷键时自动开始翻译",
		ocrHint: "请选择要翻译的区域",
		ocrCancelHint: "按 Esc 取消",
		ocrReading: "正在识别文字...",
		emptyTitle: "请输入要翻译的文本",
		emptyDescription: "AI将提供多种翻译选项并附详细说明",
		emptyHintType: "直接输入文本",
		emptyHintPaste: "从剪贴板粘贴",
		emptyHintOcr: "通过OCR从屏幕读取",
		clearText: "清空文本",
		pasteFromClipboard: "从剪贴板粘贴",
		stopTranslation: "停止翻译",
		translationCountDesc: "一次生成的翻译候选数量",
		showMore: "更多",
		moreItems: "项",
		showLess: "收起",
		minimizeWindow: "最小化",
		maximizeWindow: "最大化",
		closeWindow: "关闭",
		weeklyUsageTrendLabel: "一周使用趋势",
		translationSending: "发送中...",
		translationWaitingModel: "等待模型响应...",
		translationGenerating: "生成中...",
		translationStopped: "已停止",
		usingModel: "模型",
		sourceEstimate: "源语言推测",
		translationCandidates: "候选数",
		modelFast: "快速",
		modelBalanced: "均衡",
		modelDeliberate: "先思考再回答",
		modelGood: "标准质量",
		modelBest: "高质量",
		modelRecommended: "推荐",
		modelReasoningSlow: "这类推理模型首字较慢，但通常质量更高。",
		modelStreamingGreat: "适合流式显示",
		modelStreamingNormal: "普通流式",
		modelStreamingDelayed: "首字较慢",
		apiKeyStored: "已保存",
		apiKeySession: "仅本次会话",
		apiKeyUnset: "未设置",
		providerReady: "该提供商已可直接使用。",
		providerSetupNeeded: "先填写 API Key 才能使用该提供商。",
		providerRecommendedModel: "推荐模型",
		historyLoad: "加载",
		historyRetry: "重新翻译",
		errorApiKeyMissing: "API Key 尚未设置，请在 AI 标签页中添加。",
		errorQuota: "请检查该提供商的额度或计费设置。",
		errorModelUnavailable: "该模型当前不可用，请切换到其他模型。",
		errorRateLimit: "请求过于频繁，请稍后再试。",
		errorActionFixKeys: "打开 AI 设置",
		errorActionOpenSettings: "打开设置",
		streamingFallbackNote: "这个模型更接近一次性返回，途中显示会较少。",
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
		ocrEngine: "OCR 엔진",
		ocrHighAccuracy: "PaddleOCR (고정밀)",
		ocrHighAccuracyDesc: "정확도를 최우선으로 합니다. 시간이 조금 걸릴 수 있습니다.",
		ocrFast: "Windows 표준 (고속)",
		ocrFastDesc: "OS 표준 기능을 사용합니다. 매우 빠르지만 정확도가 떨어질 수 있습니다.",
		usageToday: "오늘 사용 횟수",
		usageTokensToday: "오늘 토큰",
		usageWeeklyTrend: "1주 추이",
		usageCountLabel: "횟수",
		usageTokensLabel: "토큰",
		waitLabel: "대기",
		generationLabel: "생성",
		totalLabel: "합계",
		inputLabel: "입력",
		outputLabel: "출력",
		usageReset: "0시 갱신",
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
		groqApiKey: "Groq API Key",
		cerebrasApiKey: "Cerebras API Key",
		translationCount: "번역 제안 수",
		defaultTargetLang: "기본 대상 언어",
		theme: "테마",
		themeDark: "다크",
		themeLight: "라이트",
		appLanguage: "앱 언어",
		save: "저장",
		close: "닫기",
		closeSettings: "설정 닫기",
		back: "뒤로",
		minimize: "최소화",
		maximize: "최대화",
		editStyle: "문체 편집",
		cancel: "취소",
		allowRewrite: "동일 언어 번역(리라이트) 허용",
		allowRewriteDescription: "비활성화 시, 원본 언어와 대상 언어가 같으면 대상 언어가 자동으로 변경됩니다.",
		confirmDiscard: "변경 사항을 취소하시겠습니까?",
		discard: "취소하고 뒤로",
		aiTabDescription: "선택한 AI 제공업체의 모델이 활성화됩니다.",
		apiOverview: "API 개요",
		apiOverviewDesc: "선택한 제공자의 공식 API 문서를 엽니다.",
		openDocs: "문서 열기",
		showTechInfo: "기술 정보 표시",
		showTechInfoDesc: "번역 시 처리 시간 및 토큰 수 표시",
		autoStart: "시작 프로그램 실행",
		autoStartDesc: "OS 시작 시 앱을 자동으로 실행합니다.",
		startMinimized: "시작 시 메인 창 숨김",
		startMinimizedDesc: "시작 시 메인 창을 숨깁니다.",
		quickShortcut: "단축키",
		quickShortcutHint: "예: CommandOrControl+Shift+H",
		applyShortcut: "적용",
		shortcutInvalid: "유효하지 않은 단축키",
		permissions: "권한",
		screenRecording: "화면 기록",
		accessibility: "손쉬운 사용",
		granted: "허용됨",
		denied: "허용 안 됨",
		grant: "허용",
		checking: "확인 중...",
		openSystemSettings: "설정 열기",
		quit: "종료",
		rememberApiKeys: "API 키 저장",
		rememberApiKeysDesc: "재시작 후에도 API 키 유지",
		apiKeyWarning: "API 키는 로컬 저장소에 저장됩니다. 공유 PC에서는 끄는 것을 권장합니다.",
		clipboardOps: "클립보드 작업",
		clipboardOpsDesc: "선택 텍스트 가져오기/치환을 위해 클립보드를 임시로 변경합니다",
		clipboardOpsWarning: "클립보드의 이미지/파일이 사라질 수 있습니다",
		clipboardOpsConfirmEnable: "클립보드 작업을 활성화할까요? 클립보드의 이미지/파일이 사라질 수 있습니다.",
		clipboardOpsConfirmReplace: "선택한 텍스트를 바꿀까요? 클립보드 내용이 사라질 수 있습니다.",
		clipboardOpsDisabled: "클립보드 작업이 비활성화되었습니다",
		replaceUnavailableLinux: "Linux에서는 선택 문장 치환이 지원되지 않습니다",
		ttsUnavailable: "이 환경에서는 음성 읽기를 사용할 수 없습니다",
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
		favoriteCurrentTranslation: "현재 번역 저장",
		toggleFavorite: "저장 상태 전환",
		deleteFavorite: "저장된 항목 삭제",
		moveUp: "위로 이동",
		moveDown: "아래로 이동",
		autoRunQuick: "빠른 번역 자동 실행",
		autoRunQuickDesc: "단축키 호출 시 자동으로 번역을 시작합니다",
		ocrHint: "번역할 영역을 선택하세요",
		ocrCancelHint: "Esc를 눌러 취소",
		ocrReading: "텍스트를 읽는 중...",
		emptyTitle: "번역할 텍스트를 입력하세요",
		emptyDescription: "AI가 여러 번역 옵션과 자세한 설명을 제공합니다",
		emptyHintType: "텍스트 직접 입력",
		emptyHintPaste: "클립보드에서 붙여넣기",
		emptyHintOcr: "OCR로 화면에서 읽기",
		clearText: "텍스트 지우기",
		pasteFromClipboard: "클립보드에서 붙여넣기",
		stopTranslation: "번역 중지",
		translationCountDesc: "한 번에 생성할 번역 제안 수입니다",
		showMore: "더 보기",
		moreItems: "개",
		showLess: "접기",
		minimizeWindow: "최소화",
		maximizeWindow: "최대화",
		closeWindow: "닫기",
		weeklyUsageTrendLabel: "1주 사용 추이",
		translationSending: "전송 중...",
		translationWaitingModel: "모델 응답 대기 중...",
		translationGenerating: "생성 중...",
		translationStopped: "중지됨",
		usingModel: "모델",
		sourceEstimate: "원문 추정",
		translationCandidates: "후보 수",
		modelFast: "빠름",
		modelBalanced: "균형형",
		modelDeliberate: "생각 후 응답",
		modelGood: "표준 품질",
		modelBest: "고품질",
		modelRecommended: "추천",
		modelReasoningSlow: "이 추론형 모델은 첫 응답이 느리지만 보통 품질이 더 좋습니다.",
		modelStreamingGreat: "스트리밍에 적합",
		modelStreamingNormal: "일반 스트리밍",
		modelStreamingDelayed: "첫 응답이 느림",
		apiKeyStored: "저장됨",
		apiKeySession: "이번 세션만",
		apiKeyUnset: "미설정",
		providerReady: "이 제공업체는 바로 사용할 수 있습니다.",
		providerSetupNeeded: "먼저 API 키를 입력해야 사용할 수 있습니다.",
		providerRecommendedModel: "추천 모델",
		historyLoad: "불러오기",
		historyRetry: "다시 번역",
		errorApiKeyMissing: "API 키가 없습니다. AI 탭에서 추가하세요.",
		errorQuota: "이 제공업체의 사용량 한도 또는 결제 설정을 확인하세요.",
		errorModelUnavailable: "이 모델은 지금 사용할 수 없습니다. 다른 모델로 바꾸세요.",
		errorRateLimit: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
		errorActionFixKeys: "AI 설정 열기",
		errorActionOpenSettings: "설정 열기",
		streamingFallbackNote: "이 모델은 실시간 스트리밍보다 한 번에 반환되는 느낌이 더 강할 수 있습니다.",
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

export function getLanguageLocale(code: AppLanguage): string {
	const locales: Record<AppLanguage, string> = {
		ja: "ja-JP",
		en: "en-US",
		zh: "zh-CN",
		ko: "ko-KR",
	};
	return locales[code];
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
