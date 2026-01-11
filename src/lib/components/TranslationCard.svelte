<script lang="ts">
	import type { TranslationResult } from "$lib/types";
	import { getTTSLanguageCode } from "$lib/utils";
	import { t, type AppLanguage } from "$lib/i18n";

	// Props
	let {
		translation,
		index,
		targetLang,
		isTranslating,
		isCompactMode = false,
		appLanguage = "ja" as AppLanguage,
		copiedId = null as number | null,
		replacedId = null as number | null,
		isSpeakingId = null as number | null,
		actionMenuOpenId = null as number | null,
		onCopy,
		onReplace,
		onSpeak,
		onToggleActionMenu,
	}: {
		translation: TranslationResult;
		index: number;
		targetLang: string;
		isTranslating: boolean;
		isCompactMode?: boolean;
		appLanguage?: AppLanguage;
		copiedId?: number | null;
		replacedId?: number | null;
		isSpeakingId?: number | null;
		actionMenuOpenId?: number | null;
		onCopy: (id: number, text: string) => void;
		onReplace: (id: number, text: string) => void;
		onSpeak: (id: number, text: string, lang: string) => void;
		onToggleActionMenu: (id: number) => void;
	} = $props();

	// Animation states
	let speakAnimating = $state(false);
	let copyAnimating = $state(false);

	// Derived
	let id = $derived(translation.id ?? index + 1);
	let hasContent = $derived(!!translation.text);
	let isCopied = $derived(copiedId === id);
	let isReplaced = $derived(replacedId === id);
	let isSpeaking = $derived(isSpeakingId === id);
	let isActionMenuOpen = $derived(actionMenuOpenId === id);

	function handleCopy() {
		if (!hasContent) return;
		copyAnimating = true;
		setTimeout(() => (copyAnimating = false), 600);
		onCopy(id, translation.text);
	}

	function handleSpeak() {
		if (!hasContent) return;
		speakAnimating = true;
		setTimeout(() => (speakAnimating = false), 1200);
		onSpeak(id, translation.text, targetLang);
	}

	function handleReplace() {
		if (!hasContent) return;
		onReplace(id, translation.text);
	}

	function handleToggleMenu() {
		onToggleActionMenu(id);
	}
</script>

<div
	class="candidate-card"
	style="animation-delay: {index * 0.1}s"
>
	<div class="card-inner-content" class:content-fade={isTranslating && !hasContent}>
		<p class="translated-text">
			{#if hasContent}
				{translation.text}
			{:else}
				&nbsp;
			{/if}
		</p>

		<div class="card-footer">
			<div class="reason">
				{#if translation.reason}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						style="flex-shrink: 0; margin-top: 2px; opacity: 0.6;"
					>
						<circle cx="12" cy="12" r="10"></circle>
						<path d="M12 16v-4"></path>
						<path d="M12 8h.01"></path>
					</svg>
					<span>{translation.reason}</span>
				{/if}
			</div>

			<div class="candidate-actions" class:hide={!hasContent && isTranslating}>
				<!-- Action menu for compact mode -->
				{#if isCompactMode}
					<div class="action-menu">
						<button
							class="icon-btn"
							onclick={handleToggleMenu}
							aria-label={t(appLanguage, "moreActions")}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<circle cx="12" cy="12" r="1"></circle>
								<circle cx="12" cy="5" r="1"></circle>
								<circle cx="12" cy="19" r="1"></circle>
							</svg>
						</button>

						{#if isActionMenuOpen}
							<div class="action-menu-dropdown">
								<button
									class="action-menu-item copy-item"
									class:animating={copyAnimating}
									class:copied={isCopied}
									onclick={handleCopy}
								>
									<span class="action-menu-icon">
										{#if isCopied}
											<svg
												class="check-icon"
												xmlns="http://www.w3.org/2000/svg"
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<path d="M20 6 9 17l-5-5" />
											</svg>
										{:else}
											<svg
												class="copy-icon"
												xmlns="http://www.w3.org/2000/svg"
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
												<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
											</svg>
										{/if}
									</span>
									{t(appLanguage, "copy")}
								</button>

								<button
									class="action-menu-item speak-item"
									class:animating={speakAnimating}
									class:active={isSpeaking}
									onclick={handleSpeak}
								>
									<span class="action-menu-icon">
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" class="wave-1" />
											<path d="M15.54 8.46a5 5 0 0 1 0 7.07" class="wave-2" />
											<path d="M19.07 4.93a10 10 0 0 1 0 14.14" class="wave-3" />
										</svg>
									</span>
									{isSpeaking ? t(appLanguage, "stop") : t(appLanguage, "speak")}
								</button>

								<button
									class="action-menu-item replace-item"
									class:replaced={isReplaced}
									onclick={handleReplace}
								>
									<span class="action-menu-icon">
										{#if isReplaced}
											<svg
												class="check-icon"
												xmlns="http://www.w3.org/2000/svg"
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<path d="M20 6 9 17l-5-5" />
											</svg>
										{:else}
											<svg
												xmlns="http://www.w3.org/2000/svg"
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
											</svg>
										{/if}
									</span>
									{t(appLanguage, "replaceSelection")}
								</button>
							</div>
						{/if}
					</div>
				{:else}
					<!-- Full action buttons for main mode -->
					<button
						class="icon-btn copy-btn"
						class:animating={copyAnimating}
						class:copied={isCopied}
						onclick={handleCopy}
						aria-label={t(appLanguage, "copy")}
						disabled={!hasContent}
					>
						{#if isCopied}
							<svg
								class="check-icon"
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M20 6 9 17l-5-5" />
							</svg>
						{:else}
							<svg
								class="copy-icon"
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
								<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
							</svg>
						{/if}
					</button>

					<button
						class="icon-btn speak-btn"
						class:animating={speakAnimating}
						class:active={isSpeaking}
						onclick={handleSpeak}
						aria-label={isSpeaking ? t(appLanguage, "stop") : t(appLanguage, "speak")}
						disabled={!hasContent}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" class="wave-1" />
							<path d="M15.54 8.46a5 5 0 0 1 0 7.07" class="wave-2" />
							<path d="M19.07 4.93a10 10 0 0 1 0 14.14" class="wave-3" />
						</svg>
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.candidate-card {
		padding: 12px 12px;
		border-radius: var(--radius-sm);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		transition:
			background 0.2s,
			border-color 0.2s;
		flex-shrink: 0;
		min-height: 80px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		animation: popIn 0.5s var(--easing) backwards;
	}

	.card-inner-content {
		width: 100%;
		transition: opacity 0.5s ease;
	}

	.card-inner-content.content-fade {
		opacity: 0;
	}

	.candidate-actions.hide {
		display: none;
	}

	/* Staggered backgrounds */
	.candidate-card:nth-child(1) {
		background: rgba(255, 255, 255, 0.12);
	}
	.candidate-card:nth-child(2) {
		background: rgba(255, 255, 255, 0.08);
	}
	.candidate-card:nth-child(3) {
		background: rgba(255, 255, 255, 0.04);
	}
	.candidate-card:nth-child(n + 4) {
		background: rgba(255, 255, 255, 0.02);
	}

	:global([data-theme="light"]) .candidate-card:nth-child(1) {
		background: rgba(0, 0, 0, 0.03);
	}
	:global([data-theme="light"]) .candidate-card:nth-child(2) {
		background: rgba(0, 0, 0, 0.05);
	}
	:global([data-theme="light"]) .candidate-card:nth-child(3) {
		background: rgba(0, 0, 0, 0.07);
	}
	:global([data-theme="light"]) .candidate-card:nth-child(n + 4) {
		background: rgba(0, 0, 0, 0.09);
	}
	:global([data-theme="light"]) .candidate-card {
		border-color: rgba(0, 0, 0, 0.08);
	}
	:global([data-theme="light"]) .candidate-card:hover {
		border-color: rgba(0, 0, 0, 0.15);
	}

	.candidate-card:hover {
		border-color: rgba(255, 255, 255, 0.12);
	}

	.translated-text {
		font-size: 16px;
		font-weight: 500;
		margin-bottom: 12px;
		color: var(--text-main);
		line-height: 1.6;
		user-select: text;
		cursor: text;
		white-space: pre-wrap;
	}

	.card-footer {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 10px;
	}

	.reason {
		font-size: 13px;
		color: var(--text-main);
		opacity: 0.9;
		flex: 1;
		line-height: 1.4;
		display: flex;
		gap: 5px;
		align-items: flex-start;
	}

	.candidate-actions {
		display: flex;
		gap: 2px;
		opacity: 0;
		transition: opacity 0.2s;
		flex-shrink: 0;
	}

	.candidate-card:hover .candidate-actions {
		opacity: 1;
	}

	.icon-btn {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 5px;
		border-radius: 4px;
		color: var(--text-muted);
		transition: all 0.2s;
	}

	.icon-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--primary-hover);
	}

	.icon-btn:active {
		transform: scale(0.92);
	}

	.icon-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	/* Action menu */
	.action-menu {
		position: relative;
		display: inline-flex;
	}

	.action-menu-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 6px;
		min-width: 150px;
		padding: 6px;
		background: rgba(24, 24, 28, 0.95);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 140;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.action-menu-item {
		border: none;
		background: transparent;
		color: var(--text-main);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 8px;
		font-size: 12px;
		cursor: pointer;
		transition:
			background 0.2s,
			color 0.2s;
	}

	.action-menu-item:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--primary-hover);
	}

	.action-menu-item.copied,
	.action-menu-item.replaced {
		color: #22c55e;
	}

	.action-menu-item.active {
		color: var(--primary-hover);
	}

	.action-menu-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
	}

	/* Animations */
	.copy-btn.animating .copy-icon,
	.action-menu-item.copy-item.animating .copy-icon {
		animation: copySlide 0.6s var(--easing);
	}

	@keyframes copySlide {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(-2px, -2px);
		}
	}

	.wave-1 {
		opacity: 1;
	}

	.wave-2,
	.wave-3 {
		opacity: 0;
	}

	.speak-btn.animating .wave-2,
	.action-menu-item.speak-item.animating .wave-2 {
		animation: wavePulse 1.2s ease-in-out;
	}

	.speak-btn.animating .wave-3,
	.action-menu-item.speak-item.animating .wave-3 {
		animation: wavePulse 1.2s ease-in-out 0.15s;
	}

	@keyframes wavePulse {
		0% {
			opacity: 0;
			transform: translateX(-2px);
		}
		30% {
			opacity: 1;
			transform: translateX(0);
		}
		70% {
			opacity: 1;
			transform: translateX(0);
		}
		100% {
			opacity: 0;
			transform: translateX(-2px);
		}
	}

	.copy-btn.copied {
		color: #22c55e;
		background: rgba(34, 197, 94, 0.15);
	}

	.check-icon {
		animation: checkPop 0.3s var(--easing);
	}

	@keyframes checkPop {
		0% {
			transform: scale(0);
			opacity: 0;
		}
		50% {
			transform: scale(1.3);
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	@keyframes popIn {
		0% {
			opacity: 0;
			transform: translateY(20px);
		}
		100% {
			opacity: 1;
			transform: translateY(0);
		}
	}

	:global([data-theme="light"]) .action-menu-dropdown {
		background: rgba(255, 255, 255, 0.95);
		border-color: rgba(0, 0, 0, 0.08);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
	}

	:global([data-theme="light"]) .action-menu-item:hover {
		background: rgba(0, 0, 0, 0.06);
		color: #2563eb;
	}

	:global([data-theme="light"]) .icon-btn:hover {
		background: rgba(0, 0, 0, 0.08);
	}
</style>
