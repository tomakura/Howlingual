<script lang="ts">
	import { fade, fly } from "svelte/transition";
	import { quintOut } from "svelte/easing";
	import { t, getTargetLanguageName } from "$lib/i18n";
	import { type AiModel } from "$lib/ai_service";

	let {
		showSettings = $bindable(),
		isCompactMode,
		isCaptureMode,
		settingsTab = $bindable("appearance"),
		appLanguage = $bindable(),
		theme = $bindable(),
		customStyles,
		moveStyle,
		deleteStyle,
		openStyleEditor,
		triggerResetStyles,
		apiKeys = $bindable(),
		selectedProvider,
		selectProvider,
		selectedModel = $bindable(),
		filteredModels,
		usageToday = { count: 0, tokens: 0 },
		weeklyUsage = [],
		usageReady,
		usageChartMetrics,
		usageChartConfig,
		weeklyMaxCount,
		weeklyMaxTokens,
		shortDate,
		getTokenLinePoints,
		showUsageHover,
		clearUsageHover,
		usageHover,
		usageChartWrapper = $bindable(),
		appVersion,
		autoRunQuick = $bindable(),
		showTechInfo = $bindable(),
		autoStartEnabled,
		toggleAutoStart,
		startMinimized = $bindable(),
		isWindows,
		ocrEngine = $bindable(),
		defaultTargetLang = $bindable(),
		allowRewrite = $bindable(),
		translationCount = $bindable(),
		quickShortcut,
		shortcutDraft = $bindable(),
		applyShortcut,
		shortcutSaving,
		shortcutError,
		getApiKeyLabel,
		getApiKeyPlaceholder,
	} = $props();

	let slideDirection = $state(1);

	function changeSettingsTab(tab: typeof settingsTab) {
		const order = [
			"appearance",
			"translation",
			"system",
			"api",
			"styles",
			"about",
		];
		const curr = order.indexOf(settingsTab);
		const next = order.indexOf(tab);
		slideDirection = next > curr ? 1 : -1;
		settingsTab = tab;
	}
</script>

{#if showSettings && !isCompactMode && !isCaptureMode}
	<div
		class="settings-overlay"
		transition:fade={{ duration: 200 }}
		onclick={() => (showSettings = false)}
		role="button"
		tabindex="0"
		onkeydown={(e) => {
			if (e.key === "Enter") {
				showSettings = false;
			}
		}}
	>
		<div
			class="settings-panel glass"
			transition:fly={{ y: 20, duration: 300 }}
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="settings-header">
				<h2>{t(appLanguage, "settings")}</h2>
				<button
					class="close-btn"
					onclick={() => (showSettings = false)}
					aria-label={t(appLanguage, "close")}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>

			<div class="settings-body-container">
				<!-- Sidebar Tabs -->
				<div class="settings-sidebar">
					<button
						class="settings-tab vertical"
						class:active={settingsTab === "appearance"}
						onclick={() => changeSettingsTab("appearance")}
					>
						{t(appLanguage, "tabAppearance")}
					</button>
					<button
						class="settings-tab vertical"
						class:active={settingsTab === "translation"}
						onclick={() => changeSettingsTab("translation")}
					>
						{t(appLanguage, "tabTranslation")}
					</button>
					<button
						class="settings-tab vertical"
						class:active={settingsTab === "system"}
						onclick={() => changeSettingsTab("system")}
					>
						{t(appLanguage, "tabSystem")}
					</button>
					<button
						class="settings-tab vertical"
						class:active={settingsTab === "api"}
						onclick={() => changeSettingsTab("api")}
					>
						{t(appLanguage, "tabAi")}
					</button>
					<button
						class="settings-tab vertical"
						class:active={settingsTab === "styles"}
						onclick={() => changeSettingsTab("styles")}
					>
						{t(appLanguage, "tabStyles")}
					</button>
					<button
						class="settings-tab vertical"
						class:active={settingsTab === "about"}
						onclick={() => changeSettingsTab("about")}
					>
						{t(appLanguage, "tabAbout")}
					</button>
				</div>

				<!-- Main Content -->
				<div class="settings-main-content">
					{#key settingsTab}
						<div
							class="tab-content-wrapper"
							in:fly={{
								y: slideDirection * 20,
								duration: 250,
								delay: 20,
								opacity: 0,
								easing: quintOut,
							}}
							out:fly={{
								y: -slideDirection * 20,
								duration: 200,
								opacity: 0,
								easing: quintOut,
							}}
							class:style-editor-content={settingsTab ===
								"styles"}
						>
							{#if settingsTab === "appearance"}
								<!-- Appearance Tab -->
								<div class="settings-section">
									<div class="settings-label">
										<label
											class="settings-label"
											for="app-lang-select"
											>{t(
												appLanguage,
												"appLanguage",
											)}</label
										>
									</div>
									<select
										id="app-lang-select"
										class="settings-select"
										bind:value={appLanguage}
									>
										<option value="ja">日本語</option>
										<option value="en">English</option>
										<option value="zh">中文</option>
										<option value="ko">한국어</option>
									</select>
								</div>

								<div class="settings-section">
									<div class="settings-label">
										{t(appLanguage, "theme")}
									</div>
									<div class="theme-toggle">
										<button
											class="theme-btn"
											class:active={theme === "dark"}
											onclick={() => (theme = "dark")}
										>
											{t(appLanguage, "themeDark")}
										</button>
										<button
											class="theme-btn"
											class:active={theme === "light"}
											onclick={() => (theme = "light")}
										>
											{t(appLanguage, "themeLight")}
										</button>
									</div>
								</div>
							{:else if settingsTab === "translation"}
								<!-- Default Target Language -->
								<div class="settings-section">
									<label
										class="settings-label"
										for="target-lang-select"
										>{t(
											appLanguage,
											"defaultTargetLang",
										)}</label
									>
									<select
										id="target-lang-select"
										class="settings-select"
										bind:value={defaultTargetLang}
									>
										<option value="日本語"
											>{getTargetLanguageName(
												appLanguage,
												"日本語",
											)}</option
										>
										<option value="英語"
											>{getTargetLanguageName(
												appLanguage,
												"英語",
											)}</option
										>
										<option value="中国語"
											>{getTargetLanguageName(
												appLanguage,
												"中国語",
											)}</option
										>
										<option value="韓国語"
											>{getTargetLanguageName(
												appLanguage,
												"韓国語",
											)}</option
										>
										<option value="フランス語"
											>{getTargetLanguageName(
												appLanguage,
												"フランス語",
											)}</option
										>
										<option value="ドイツ語"
											>{getTargetLanguageName(
												appLanguage,
												"ドイツ語",
											)}</option
										>
										<option value="スペイン語"
											>{getTargetLanguageName(
												appLanguage,
												"スペイン語",
											)}</option
										>
									</select>
								</div>

								<!-- Allow Rewrite -->
								<div class="settings-section">
									<div class="settings-label">
										{t(appLanguage, "allowRewrite")}
									</div>
									<div class="settings-card-row">
										<span
											id="allow-rewrite-label"
											style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
										>
											{t(
												appLanguage,
												"allowRewriteDescription",
											)}
										</span>
										<button
											onclick={() =>
												(allowRewrite = !allowRewrite)}
											style="
                          width: 44px; 
                          height: 24px; 
                          background: {allowRewrite
												? '#3b82f6'
												: 'rgba(255,255,255,0.1)'}; 
                          border-radius: 99px; 
                          position: relative; 
                          border: none; 
                          cursor: pointer;
                          transition: background 0.2s;"
											aria-labelledby="allow-rewrite-label"
										>
											<div
												style="
                            width: 18px; 
                            height: 18px; 
                            background: white; 
                            border-radius: 50%; 
                            position: absolute; 
                            top: 3px; 
                            left: {allowRewrite ? '23px' : '3px'}; 
                            transition: left 0.2s;"
											></div>
										</button>
									</div>
								</div>

								<!-- Translation Count -->
								<div class="settings-section">
									<div class="settings-label">
										{t(appLanguage, "translationCount") ||
											"翻訳案の個数"}
									</div>
									<div class="settings-card-row">
										<span
											style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
										>
											{t(
												appLanguage,
												"translationCountDesc",
											) ||
												"1回の翻訳で生成する翻訳案の数"}
										</span>
										<div style="display: flex; gap: 4px;">
											{#each [1, 2, 3] as count}
												<button
													onclick={() =>
														(translationCount =
															count as 1 | 2 | 3)}
													style="
                                width: 36px;
                                height: 28px;
                                background: {translationCount === count
														? '#3b82f6'
														: 'rgba(255,255,255,0.1)'};
                                border: 1px solid {translationCount === count
														? '#3b82f6'
														: 'rgba(255,255,255,0.2)'};
                                border-radius: 6px;
                                color: {translationCount === count
														? 'white'
														: 'var(--text-muted)'};
                                font-size: 13px;
                                font-weight: 500;
                                cursor: pointer;
                                transition: all 0.2s;
                              "
												>
													{count}
												</button>
											{/each}
										</div>
									</div>
								</div>

								<!-- Auto Run Quick -->
								<div class="settings-section">
									<div class="settings-label">
										{t(appLanguage, "autoRunQuick") ||
											"ショートカット呼び出し時に自動翻訳"}
									</div>
									<div class="settings-card-row">
										<span
											id="auto-run-label"
											style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
										>
											{t(
												appLanguage,
												"autoRunQuickDesc",
											) ||
												"ショートカット呼出時に自動で翻訳を開始します"}
										</span>
										<button
											onclick={() =>
												(autoRunQuick = !autoRunQuick)}
											style="
                      width: 44px; 
                      height: 24px; 
                      background: {autoRunQuick
												? '#3b82f6'
												: 'rgba(255,255,255,0.1)'}; 
                      border-radius: 99px; 
                      position: relative; 
                      border: none; 
                      cursor: pointer;
                      transition: background 0.2s;"
											aria-labelledby="auto-run-label"
										>
											<div
												style="
                        width: 18px; 
                        height: 18px; 
                        background: white; 
                        border-radius: 50%; 
                        position: absolute; 
                        top: 3px; 
                        left: {autoRunQuick ? '23px' : '3px'}; 
                        transition: left 0.2s;"
											></div>
										</button>
									</div>
								</div>

								<!-- Technical Info -->
								<div class="settings-section">
									<div class="settings-label">
										{t(appLanguage, "showTechInfo") ||
											"技術情報を表示"}
									</div>
									<div class="settings-card-row">
										<span
											id="tech-info-label"
											style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
										>
											{t(
												appLanguage,
												"showTechInfoDesc",
											) ||
												"翻訳時に処理時間やトークン数を表示します"}
										</span>
										<button
											onclick={() =>
												(showTechInfo = !showTechInfo)}
											style="
                      width: 44px; 
                      height: 24px; 
                      background: {showTechInfo
												? '#3b82f6'
												: 'rgba(255,255,255,0.1)'}; 
                      border-radius: 99px; 
                      position: relative; 
                      border: none; 
                      cursor: pointer;
                      transition: background 0.2s;"
											aria-labelledby="tech-info-label"
										>
											<div
												style="
                        width: 18px; 
                        height: 18px; 
                        background: white; 
                        border-radius: 50%; 
                        position: absolute; 
                        top: 3px; 
                        left: {showTechInfo ? '23px' : '3px'}; 
                        transition: left 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
                        box-shadow: 0 1px 3px rgba(0,0,0,0.2);"
											></div>
										</button>
									</div>
								</div>
							{:else if settingsTab === "system"}
								<!-- Auto Start -->
								<div class="settings-section">
									<div class="settings-label">
										{t(appLanguage, "autoStart") ||
											"スタートアップ起動"}
									</div>
									<div class="settings-card-row">
										<span
											style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
										>
											{t(appLanguage, "autoStartDesc") ||
												"OS 起動時にアプリを自動で起動します"}
										</span>
										<button
											onclick={toggleAutoStart}
											style="
                      width: 44px; 
                      height: 24px; 
                      background: {autoStartEnabled
												? '#3b82f6'
												: 'rgba(255,255,255,0.1)'}; 
                      border-radius: 20px; 
                      border: none;
                      cursor: pointer;
                      position: relative;
                      transition: background 0.2s;
                    "
											aria-label="Toggle autostart"
										>
											<div
												style="
                        width: 18px; 
                        height: 18px; 
                        background: white; 
                        border-radius: 50%; 
                        position: absolute; 
                        top: 3px; 
                        left: {autoStartEnabled ? '23px' : '3px'}; 
                        transition: left 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
                        box-shadow: 0 1px 3px rgba(0,0,0,0.2);"
											></div>
										</button>
									</div>
								</div>

								<!-- Start Minimized -->
								<div class="settings-section">
									<div class="settings-label">
										{t(appLanguage, "startMinimized") ||
											"起動時はメイン画面を最小化"}
									</div>
									<div class="settings-card-row">
										<span
											style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
										>
											{t(
												appLanguage,
												"startMinimizedDesc",
											) ||
												"起動時にメイン画面を最小化して開始します"}
										</span>
										<button
											onclick={() =>
												(startMinimized =
													!startMinimized)}
											style="
                      width: 44px; 
                      height: 24px; 
                      background: {startMinimized
												? '#3b82f6'
												: 'rgba(255,255,255,0.1)'}; 
                      border-radius: 20px; 
                      border: none;
                      cursor: pointer;
                      position: relative;
                      transition: background 0.2s;
                    "
											aria-label="Toggle start minimized"
										>
											<div
												style="
                        width: 18px; 
                        height: 18px; 
                        background: white; 
                        border-radius: 50%; 
                        position: absolute; 
                        top: 3px; 
                        left: {startMinimized ? '23px' : '3px'}; 
                        transition: left 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
                        box-shadow: 0 1px 3px rgba(0,0,0,0.2);"
											></div>
										</button>
									</div>
								</div>

								{#if isWindows}
									<!-- OCR Engine -->
									<div class="settings-section">
										<div class="settings-label">
											{t(appLanguage, "ocrEngine")}
										</div>
										<div
											class="settings-card-row"
											style="flex-direction: column; gap: 12px; align-items: flex-start;"
										>
											<label
												style="display: flex; align-items: center; gap: 10px; cursor: pointer; width: 100%;"
											>
												<input
													type="radio"
													name="ocrEngine"
													value="paddle"
													bind:group={ocrEngine}
													style="cursor: pointer;"
												/>
												<span style="flex: 1;">
													<div
														style="font-size: 14px; color: var(--text-main); font-weight: 500;"
													>
														{t(
															appLanguage,
															"ocrHighAccuracy",
														)}
													</div>
													<div
														style="font-size: 12px; color: var(--text-muted); margin-top: 2px;"
													>
														{t(
															appLanguage,
															"ocrHighAccuracyDesc",
														)}
													</div>
												</span>
											</label>
											<label
												style="display: flex; align-items: center; gap: 10px; cursor: pointer; width: 100%;"
											>
												<input
													type="radio"
													name="ocrEngine"
													value="windows"
													bind:group={ocrEngine}
													style="cursor: pointer;"
												/>
												<span style="flex: 1;">
													<div
														style="font-size: 14px; color: var(--text-main); font-weight: 500;"
													>
														{t(
															appLanguage,
															"ocrFast",
														)}
													</div>
													<div
														style="font-size: 12px; color: var(--text-muted); margin-top: 2px;"
													>
														{t(
															appLanguage,
															"ocrFastDesc",
														)}
													</div>
												</span>
											</label>
										</div>
									</div>
								{/if}

								<!-- Quick Shortcut -->
								<div class="settings-section">
									<label
										class="settings-label"
										for="quick-shortcut-input"
										>{t(
											appLanguage,
											"quickShortcut",
										)}</label
									>
									<div class="shortcut-row">
										<input
											id="quick-shortcut-input"
											class="settings-input"
											bind:value={shortcutDraft}
											placeholder={t(
												appLanguage,
												"quickShortcutHint",
											)}
											onkeydown={(e) => {
												e.preventDefault();
												e.stopPropagation();

												// Ignore standalone modifier keys
												if (
													[
														"Control",
														"Shift",
														"Alt",
														"Meta",
													].includes(e.key)
												) {
													return;
												}

												// Reset current draft
												let parts = [];
												const isMac =
													navigator.userAgent.includes(
														"Mac",
													);

												if (e.metaKey) {
													if (isMac)
														parts.push("Command");
													else parts.push("Super");
												}
												if (e.ctrlKey)
													parts.push("Ctrl");
												if (e.altKey) parts.push("Alt");
												if (e.shiftKey)
													parts.push("Shift");

												// Handle key
												let key = e.key.toUpperCase();
												if (key === " ") key = "Space";
												// Function keys
												if (
													key.length > 1 &&
													!key.startsWith("F") &&
													key !== "Space" &&
													key !== "ENTER" &&
													key !== "TAB"
												) {
													// E.g. "PageUp"
													// Just use as is
												}

												parts.push(key);
												shortcutDraft = parts.join("+");
											}}
										/>
										<button
											class="save-btn apply-shortcut-btn"
											onclick={() => void applyShortcut()}
											disabled={shortcutSaving ||
												shortcutDraft.trim() === "" ||
												shortcutDraft === quickShortcut}
										>
											{t(appLanguage, "applyShortcut")}
										</button>
									</div>
									<div class="shortcut-hint">
										{t(appLanguage, "quickShortcutHint")}
									</div>
									{#if shortcutError}
										<div class="shortcut-error">
											{shortcutError}
										</div>
									{/if}
								</div>
							{:else if settingsTab === "api"}
								<!-- AI Settings Tab -->
								<p
									class="settings-description"
									style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;"
								>
									{t(appLanguage, "aiTabDescription") ||
										"選択したAIプロバイダーのモデルが有効になります。"}
								</p>

								<!-- Provider Switcher -->
								<div class="provider-switcher">
									<button
										class="provider-btn"
										class:active={selectedProvider ===
											"openai"}
										onclick={() => selectProvider("openai")}
									>
										OpenAI
									</button>
									<button
										class="provider-btn"
										class:active={selectedProvider ===
											"gemini"}
										onclick={() => selectProvider("gemini")}
									>
										Gemini
									</button>
									<button
										class="provider-btn"
										class:active={selectedProvider ===
											"anthropic"}
										onclick={() =>
											selectProvider("anthropic")}
									>
										Anthropic
									</button>
									<button
										class="provider-btn"
										class:active={selectedProvider ===
											"groq"}
										onclick={() => selectProvider("groq")}
									>
										Groq
									</button>
									<button
										class="provider-btn"
										class:active={selectedProvider ===
											"cerebras"}
										onclick={() =>
											selectProvider("cerebras")}
									>
										Cerebras
									</button>
								</div>

								<!-- API Key for Selected Provider -->
								<div class="settings-section">
									<label
										class="settings-label"
										for="api-key-input"
									>
										{getApiKeyLabel(selectedProvider)}
									</label>
									<input
										id="api-key-input"
										type="password"
										class="settings-input"
										bind:value={apiKeys[selectedProvider]}
										placeholder={getApiKeyPlaceholder(
											selectedProvider,
										)}
									/>
								</div>

								<!-- Model Selection (Filtered) -->
								<div class="settings-section">
									<label
										class="settings-label"
										for="model-select"
										>{t(appLanguage, "aiModel")}</label
									>
									<select
										id="model-select"
										class="settings-select"
										bind:value={selectedModel}
									>
										{#each filteredModels as model}
											<option value={model.value}
												>{model.label}</option
											>
										{/each}
									</select>
								</div>
							{:else if settingsTab === "styles"}
								<!-- Styles Tab -->
								<div class="styles-actions-top">
									<button
										class="rich-btn primary"
										onclick={() => openStyleEditor()}
									>
										<svg
											width="18"
											height="18"
											viewBox="0 0 24 24"
											fill="none"
											class="btn-icon-left"
											stroke="currentColor"
											stroke-width="2"
										>
											<line x1="12" y1="5" x2="12" y2="19"
											></line>
											<line x1="5" y1="12" x2="19" y2="12"
											></line>
										</svg>
										{t(appLanguage, "addStyle")}
									</button>
									<button
										class="rich-btn danger"
										onclick={triggerResetStyles}
									>
										<svg
											width="18"
											height="18"
											viewBox="0 0 24 24"
											fill="none"
											class="btn-icon-left"
											stroke="currentColor"
											stroke-width="2"
										>
											<path
												d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
											></path>
											<path d="M3 3v5h5"></path>
										</svg>
										{t(appLanguage, "resetStyles")}
									</button>
								</div>

								<div class="styles-list-container">
									{#each customStyles as style, i (style.id)}
										<div class="style-item-card">
											<div class="style-header-row">
												<span class="style-name-display"
													>{style.name}</span
												>
												<div
													class="style-header-actions"
												>
													<div
														class="move-actions"
														style="display: flex; gap: 2px; margin-right: 8px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 8px;"
													>
														<button
															class="icon-btn-small"
															onclick={() =>
																moveStyle(
																	i,
																	"up",
																)}
															disabled={i === 0}
															title="Move Up"
														>
															<svg
																width="16"
																height="16"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
															>
																<polyline
																	points="18 15 12 9 6 15"
																></polyline>
															</svg>
														</button>
														<button
															class="icon-btn-small"
															onclick={() =>
																moveStyle(
																	i,
																	"down",
																)}
															disabled={i ===
																customStyles.length -
																	1}
															title="Move Down"
														>
															<svg
																width="16"
																height="16"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
															>
																<polyline
																	points="6 9 12 15 18 9"
																></polyline>
															</svg>
														</button>
													</div>
													<div
														style="display: flex; flex-direction: column; gap: 4px;"
													>
														<button
															class="icon-btn-small"
															title={t(
																appLanguage,
																"editStyle",
															)}
															onclick={() =>
																openStyleEditor(
																	style,
																)}
														>
															<svg
																width="16"
																height="16"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
															>
																<path
																	d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
																></path>
																<path
																	d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
																></path>
															</svg>
														</button>
														<button
															class="icon-btn-small danger"
															title={t(
																appLanguage,
																"delete",
															)}
															onclick={() =>
																deleteStyle(
																	style.id,
																)}
														>
															<svg
																width="16"
																height="16"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
															>
																<polyline
																	points="3 6 5 6 21 6"
																></polyline>
																<path
																	d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
																></path>
															</svg>
														</button>
													</div>
												</div>
											</div>
											<p class="style-prompt-text">
												{style.prompt}
											</p>
										</div>
									{/each}
								</div>
							{:else if settingsTab === "about"}
								<!-- About Tab -->
								<div class="about-tab-content">
									<div class="about-brand-section">
										<div class="about-logo-wrapper">
											<img
												src={theme === "light"
													? "icon-full-light.svg"
													: "icon-full-dark.svg"}
												alt="Howlingual Logo"
												style="width: 100px; height: 100px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2));"
											/>
										</div>
										<div class="about-text-content">
											<h2>Howlingual</h2>
											<p>Version {appVersion}</p>
										</div>
										<div class="about-footer-info">
											<p>© 2026 tomakura</p>
										</div>
									</div>

									<div class="about-usage-section">
										<div class="usage-cards">
											<div class="usage-card">
												<span class="usage-label">
													{t(
														appLanguage,
														"usageToday",
													) || "今日の使用回数"}
												</span>
												<span class="usage-value"
													>{usageToday.count}</span
												>
											</div>
											<div class="usage-card">
												<span class="usage-label">
													{t(
														appLanguage,
														"usageTokensToday",
													) || "今日のトークン"}
												</span>
												<span class="usage-value">
													{usageToday.tokens.toLocaleString()}
												</span>
											</div>
										</div>

										<div class="usage-chart-card">
											<div class="usage-chart-header">
												{t(
													appLanguage,
													"usageWeeklyTrend",
												) || "1週間の推移"}
											</div>
											<div
												class="usage-chart-wrapper"
												bind:this={usageChartWrapper}
											>
												{#if usageReady}
													<svg
														class="usage-chart"
														viewBox={`0 0 ${usageChartMetrics.width} ${usageChartConfig.height}`}
														preserveAspectRatio="xMidYMid meet"
														role="img"
														aria-label="Weekly usage trend"
														onmouseleave={clearUsageHover}
													>
														<line
															class="usage-chart-baseline"
															x1="12"
															x2={usageChartMetrics.width -
																12}
															y1={usageChartConfig.baseline}
															y2={usageChartConfig.baseline}
														/>
														{#each weeklyUsage as day, i}
															<g
																class="usage-day"
															>
																<rect
																	class="usage-hover-hit"
																	x={usageChartMetrics.paddingX +
																		i *
																			(usageChartMetrics.barWidth +
																				usageChartMetrics.gap) -
																		usageChartMetrics.gap}
																	y="0"
																	width={usageChartMetrics.barWidth +
																		usageChartMetrics.gap *
																			2}
																	height={usageChartConfig.height}
																	rx="0"
																	role="presentation"
																	aria-hidden="true"
																	onmousemove={(
																		event,
																	) =>
																		showUsageHover(
																			event,
																			day,
																		)}
																	onmouseleave={clearUsageHover}
																/>
																<rect
																	class="usage-bar"
																	x={usageChartMetrics.paddingX +
																		i *
																			(usageChartMetrics.barWidth +
																				usageChartMetrics.gap)}
																	y={usageChartConfig.baseline -
																		(day.count /
																			weeklyMaxCount) *
																			usageChartConfig.barMaxHeight}
																	width={usageChartMetrics.barWidth}
																	height={(day.count /
																		weeklyMaxCount) *
																		usageChartConfig.barMaxHeight}
																	rx="4"
																/>
																<circle
																	class="usage-line-dot"
																	cx={usageChartMetrics.paddingX +
																		i *
																			(usageChartMetrics.barWidth +
																				usageChartMetrics.gap) +
																		usageChartMetrics.barWidth /
																			2}
																	cy={usageChartConfig.baseline -
																		(day.tokens /
																			weeklyMaxTokens) *
																			usageChartConfig.barMaxHeight}
																	r="3"
																/>
																<text
																	class="usage-chart-label"
																	x={usageChartMetrics.paddingX +
																		i *
																			(usageChartMetrics.barWidth +
																				usageChartMetrics.gap) +
																		usageChartMetrics.barWidth /
																			2}
																	y={usageChartConfig.labelY}
																	text-anchor="middle"
																>
																	{shortDate(
																		day.date,
																	)}
																</text>
															</g>
														{/each}
														<polyline
															class="usage-line"
															points={getTokenLinePoints()}
														/>
													</svg>
													{#if usageHover}
														<div
															class="usage-tooltip"
															style={`left: ${usageHover.x}px; top: ${usageHover.y}px;`}
														>
															<div
																class="usage-tooltip-date"
															>
																{shortDate(
																	usageHover
																		.day
																		.date,
																)}
															</div>
															<div
																class="usage-tooltip-row"
															>
																<span
																	class="legend-dot count"
																></span>
																<span>
																	{t(
																		appLanguage,
																		"usageCountLabel",
																	) ||
																		"回数"}: {usageHover
																		.day
																		.count}
																</span>
															</div>
															<div
																class="usage-tooltip-row"
															>
																<span
																	class="legend-dot tokens"
																></span>
																<span>
																	{t(
																		appLanguage,
																		"usageTokensLabel",
																	) ||
																		"トークン"}:
																	{usageHover.day.tokens.toLocaleString()}
																</span>
															</div>
														</div>
													{/if}
												{:else}
													<div
														class="usage-chart-skeleton"
													></div>
												{/if}
											</div>
											<div class="usage-chart-legend">
												<span class="legend-item">
													<span
														class="legend-dot count"
													></span>
													{t(
														appLanguage,
														"usageCountLabel",
													) || "回数"}
												</span>
												<span class="legend-item">
													<span
														class="legend-dot tokens"
													></span>
													{t(
														appLanguage,
														"usageTokensLabel",
													) || "トークン"}
												</span>
											</div>
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/key}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Settings Modal Styles */
	.settings-overlay {
		all: unset;
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 2000;
		display: flex;
		justify-content: center;
		align-items: center;
		backdrop-filter: blur(4px);
		cursor: default;
	}

	.settings-panel {
		width: 95%;
		max-width: 800px;
		height: 95%;
		max-height: 800px;
		background: var(--glass-color);
		border: 1px solid var(--border-color);
		border-radius: 16px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
		transition:
			max-width 0.3s cubic-bezier(0.16, 1, 0.3, 1),
			height 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.settings-panel.style-editor-mode {
		max-width: 1000px;
		height: 80vh;
	}

	.style-item-card {
		background: rgba(255, 255, 255, 0.05); /* Slightly lighter */
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 8px;
		padding: 8px 12px; /* Reduced from 12px */
		display: flex;
		flex-direction: column;
		gap: 4px; /* Reduced gap */
		transition: all 0.2s;
	}

	.settings-header {
		display: flex;
		justify-content: space-between;
		align-items: center;

		border-bottom: 1px solid var(--border-color);
	}

	.settings-header h2 {
		font-size: 18px;
		font-weight: 600;
		padding-top: 10px;
		padding-bottom: 10px;
		padding-left: 15px;
		padding-right: 15px;
		color: var(--text-main);
		margin: 0;
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 5px;
		margin-right: 15px;
		border-radius: 4px;
		transition: all 0.2s;
	}
	.close-btn:hover {
		color: var(--text-main);
		background: rgba(255, 255, 255, 0.1);
	}

	.settings-body-container {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	.settings-sidebar {
		width: 140px;
		border-right: 1px solid var(--border-color);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: rgba(0, 0, 0, 0.1);
	}

	.settings-tab {
		padding: 10px 12px;
		background: transparent;
		border: none;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		width: 100%;
	}
	.settings-tab:hover {
		color: var(--text-main);
		background: rgba(255, 255, 255, 0.05);
	}
	.settings-tab.active {
		color: var(--primary-color);
		background: rgba(59, 130, 246, 0.1); /* Primary subtle bg */
	}

	.settings-main-content {
		flex: 1;
		position: relative;
		overflow: hidden;
		background: rgba(0, 0, 0, 0.1); /* Slightly darker content area */
	}

	/* The scrolling container for the tab content */
	.tab-content-wrapper {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.shortcut-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.shortcut-row .settings-input {
		flex: 1;
	}

	.apply-shortcut-btn {
		min-width: 88px;
		height: 40px; /* Match .settings-input height (10px*2 + 14px line + 1px*2 border approx) */
	}

	.save-btn.apply-shortcut-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.shortcut-hint {
		font-size: 12px;
		color: var(--text-muted);
	}

	.shortcut-error {
		font-size: 12px;
		color: #f87171;
	}

	.settings-select,
	.settings-input,
	.settings-card-row {
		background: rgba(0, 0, 0, 0.2);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 14px;
		color: var(--text-main);
		outline: none;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.settings-card-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.settings-select:focus,
	.settings-input:focus {
		border-color: var(--primary-color);
		box-shadow: 0 0 0 2px rgba(var(--primary-rgb, 100, 150, 255), 0.2);
	}

	.settings-select option {
		background: #1a1a2e;
		color: var(--text-main);
	}

	.settings-content.style-editor-content {
		padding: 30px;
	}

	.settings-footer {
		padding: 20px;
		border-top: 1px solid var(--border-color);
		display: flex;
		gap: 10px;
	}

	.save-btn {
		width: 100%;
		padding: 12px;
		background: var(--primary-color);
		border: none;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		color: #fff;
		cursor: pointer;
		transition: all 0.2s;
	}
	.save-btn:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}
	.save-btn:active {
		transform: translateY(0);
	}

	/* Styles Tab Improvements */
	.styles-actions-top {
		display: flex;
		gap: 12px;
		margin-bottom: 20px;
	}

	.rich-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 10px 16px;
		border-radius: 12px;
		font-weight: 500;
		font-size: 14px;
		cursor: pointer;
		border: 1px solid rgba(255, 255, 255, 0.1);
		transition: all 0.2s ease;
		backdrop-filter: blur(4px);
	}

	.rich-btn.primary {
		background: linear-gradient(
			135deg,
			rgba(59, 130, 246, 0.2),
			rgba(59, 130, 246, 0.1)
		);
		color: #60a5fa;
		border-color: rgba(59, 130, 246, 0.2);
	}

	.rich-btn.primary:hover {
		background: linear-gradient(
			135deg,
			rgba(59, 130, 246, 0.3),
			rgba(59, 130, 246, 0.2)
		);
	}

	.rich-btn.danger {
		background: linear-gradient(
			135deg,
			rgba(239, 68, 68, 0.15),
			rgba(239, 68, 68, 0.05)
		);
		color: #f87171;
		border-color: rgba(239, 68, 68, 0.2);
	}

	.rich-btn.danger:hover {
		background: linear-gradient(
			135deg,
			rgba(239, 68, 68, 0.25),
			rgba(239, 68, 68, 0.15)
		);
	}

	.rich-btn.secondary {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text-secondary);
	}

	.rich-btn.secondary:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.btn-icon-left {
		margin-right: -4px;
	}

	.style-item-card {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 12px;
		transition: all 0.2s ease;
	}

	.style-header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 32px;
	}

	.style-name-display {
		font-weight: 600;
		color: var(--text-main);
		font-size: 15px;
	}

	.style-header-actions {
		display: flex;
		gap: 2px;
	}

	.icon-btn-small {
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.icon-btn-small:hover {
		background: rgba(255, 255, 255, 0.1);
		color: white;
	}

	.icon-btn-small.delete-btn:hover {
		background: rgba(239, 68, 68, 0.2);
		color: #f87171;
	}

	.theme-toggle {
		display: flex;
		gap: 8px;
	}

	.theme-btn {
		flex: 1;
		padding: 10px;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		font-size: 13px;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s;
	}
	.theme-btn:hover {
		background: rgba(255, 255, 255, 0.05);
		color: var(--text-main);
	}
	.theme-btn.active {
		background: var(--primary-color);
		border-color: var(--primary-color);
		color: #fff;
	}

	/* Provider Switcher */
	.provider-switcher {
		display: flex;
		background: rgba(0, 0, 0, 0.2);
		padding: 4px;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		margin-bottom: 20px;
	}

	.provider-btn {
		flex: 1;
		padding: 8px;
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--text-muted);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.provider-btn:hover {
		color: var(--text-main);
		background: rgba(255, 255, 255, 0.05);
	}

	.provider-btn.active {
		background: rgba(59, 130, 246, 0.2);
		color: #60a5fa;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.style-prompt-text {
		margin-top: 8px;
		font-size: 13px;
		color: var(--text-muted);
		white-space: pre-wrap;
		line-height: 1.6;
	}

	.about-tab-content {
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding: 24px;
		height: 100%;
	}

	.about-usage-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.usage-cards {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}

	.usage-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 14px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.usage-label {
		font-size: 12px;
		color: var(--text-muted);
	}

	.usage-value {
		font-size: 26px;
		font-weight: 700;
		color: var(--text-main);
	}

	.usage-chart-card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 16px;
		padding: 16px;
		margin-bottom: 16px;
	}

	.usage-chart-header {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-main);
		margin-bottom: 10px;
	}

	.usage-chart-wrapper {
		width: 100%;
		padding-bottom: 8px;
		position: relative;
	}

	.usage-chart {
		width: 100%;
		height: 200px;
	}

	.usage-chart-baseline {
		stroke: var(--border-color);
		stroke-width: 1;
		opacity: 0.7;
	}

	.usage-bar {
		fill: rgba(99, 102, 241, 0.35);
		pointer-events: none;
	}

	.usage-line {
		fill: none;
		stroke: #22d3ee;
		stroke-width: 2;
		pointer-events: none;
	}

	.usage-line-dot {
		fill: #22d3ee;
		pointer-events: none;
	}

	.usage-hover-hit {
		fill: transparent;
		pointer-events: all;
	}

	.usage-chart-label {
		font-size: 12px;
		fill: var(--text-muted);
	}

	.usage-tooltip {
		position: absolute;
		pointer-events: none;
		transform: translate(-50%, -120%);
		background: rgba(24, 24, 27, 0.92);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		padding: 8px 10px;
		color: var(--text-main);
		font-size: 12px;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
		white-space: nowrap;
		z-index: 1;
	}

	.usage-tooltip-date {
		font-weight: 600;
		margin-bottom: 4px;
		font-size: 12px;
	}

	.usage-tooltip-row {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-muted);
		margin-bottom: 2px;
	}

	.usage-tooltip-row:last-child {
		margin-bottom: 0;
	}

	.usage-chart-legend {
		display: flex;
		gap: 12px;
		align-items: center;
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 8px;
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}

	.legend-dot.count {
		background: rgba(99, 102, 241, 0.6);
	}

	.legend-dot.tokens {
		background: #22d3ee;
	}

	.usage-chart-skeleton {
		width: 100%;
		height: 200px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px dashed rgba(255, 255, 255, 0.12);
	}

	.about-brand-section {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 8px;
	}

	.about-text-content h2 {
		font-size: 30px;
		font-weight: 700;
		margin: 0;
		color: var(--text-main);
	}

	.about-text-content p {
		font-size: 14px;
		color: var(--text-muted);
		margin: 0;
	}

	.about-footer-info {
		font-size: 12px;
		color: var(--text-muted);
		opacity: 0.6;
	}

	/* Prevent logo from being dragged */
	.about-logo-wrapper img {
		-webkit-user-drag: none;
		user-select: none;
		pointer-events: none;
	}

	.settings-label {
		margin-bottom: 6px;
		font-size: 14px;
		color: var(--text-main);
		font-weight: 500;
	}
</style>
