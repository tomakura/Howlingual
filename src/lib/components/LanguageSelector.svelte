<script lang="ts">
	import { t, getTargetLanguageName, type AppLanguage } from "$lib/i18n";
	import { SUPPORTED_LANGUAGES, AUTO_DETECT_LABEL } from "$lib/constants";

	// Props
	let {
		isSource = false,
		selectedLang,
		isAutoDetect = false,
		detectedLang = "",
		isDetecting = false,
		appLanguage = "ja" as AppLanguage,
		disabled = false,
		onSelect,
	}: {
		isSource?: boolean;
		selectedLang: string;
		isAutoDetect?: boolean;
		detectedLang?: string;
		isDetecting?: boolean;
		appLanguage?: AppLanguage;
		disabled?: boolean;
		onSelect: (lang: string | null) => void;
	} = $props();

	let showMenu = $state(false);
	let isSparkling = $state(false);

	function handleSelect(lang: string | null) {
		if (lang === null && isSource) {
			// Auto-detect selected
			isSparkling = true;
			setTimeout(() => (isSparkling = false), 1000);
		}
		onSelect(lang);
		showMenu = false;
	}

	function toggleMenu() {
		if (!disabled) {
			showMenu = !showMenu;
		}
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest(".lang-selector")) {
			showMenu = false;
		}
	}

	// Derived display values
	let displayLabel = $derived.by(() => {
		if (isSource) {
			if (isAutoDetect) {
				if (isDetecting) {
					return t(appLanguage, "detecting");
				} else if (detectedLang) {
					return `${t(appLanguage, "detected")}: ${getTargetLanguageName(appLanguage, detectedLang)}`;
				} else {
					return t(appLanguage, "autoDetect");
				}
			} else {
				return getTargetLanguageName(appLanguage, selectedLang);
			}
		} else {
			return getTargetLanguageName(appLanguage, selectedLang);
		}
	});
</script>

<svelte:window onclick={handleClickOutside} />

<div class="lang-selector">
	<button
		class="lang-btn"
		class:sparkling={isSparkling}
		onclick={toggleMenu}
		{disabled}
	>
		{#if isSource && isAutoDetect}
			<span class="detecting-label" class:detecting={isDetecting}>
				{#if isDetecting}
					<svg
						class="detecting-spinner"
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
						<path d="M12 2a10 10 0 0 1 10 10" />
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
						<path
							d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
						/>
					</svg>
				{/if}
				{displayLabel}
			</span>
		{:else}
			<span>{displayLabel}</span>
		{/if}
		<svg
			class="chevron"
			class:open={showMenu}
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
			<path d="m6 9 6 6 6-6" />
		</svg>
	</button>

	{#if showMenu}
		<div class="lang-menu">
			{#if isSource}
				<button
					class="lang-option"
					class:active={isAutoDetect}
					onclick={() => handleSelect(null)}
				>
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
						style="margin-right: 6px;"
					>
						<path
							d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
						/>
					</svg>
					{t(appLanguage, "autoDetect")}
				</button>
			{/if}
			{#each SUPPORTED_LANGUAGES as lang}
				<button
					class="lang-option"
					class:active={!isAutoDetect && selectedLang === lang}
					onclick={() => handleSelect(lang)}
				>
					{getTargetLanguageName(appLanguage, lang)}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.lang-selector {
		position: relative;
	}

	.lang-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 14px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		color: var(--text-main);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		min-width: 15rem;
		position: relative;
	}

	.lang-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.15);
	}

	.lang-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		pointer-events: none;
	}

	.lang-btn span,
	.detecting-label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.detecting-label.detecting {
		color: var(--primary-color);
	}

	.detecting-spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.sparkling {
		animation: sparkle 1s ease-out;
	}

	@keyframes sparkle {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
		}
		50% {
			box-shadow: 0 0 12px 4px rgba(59, 130, 246, 0.4);
		}
	}

	.chevron {
		transition: transform 0.2s ease;
		flex-shrink: 0;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	.lang-menu {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 4px;
		min-width: 100%;
		background: rgba(24, 24, 28, 0.98);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		padding: 6px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
		z-index: 200;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.lang-option {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 10px 12px;
		background: transparent;
		border: none;
		border-radius: 8px;
		color: var(--text-main);
		font-size: 14px;
		cursor: pointer;
		transition: background 0.2s;
	}

	.lang-option:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.lang-option.active {
		background: rgba(59, 130, 246, 0.15);
		color: var(--primary-color);
	}

	/* Light mode */
	:global([data-theme="light"]) .lang-btn {
		background: rgba(0, 0, 0, 0.04);
		border-color: rgba(0, 0, 0, 0.1);
	}

	:global([data-theme="light"]) .lang-btn:hover:not(:disabled) {
		background: rgba(0, 0, 0, 0.08);
		border-color: rgba(0, 0, 0, 0.15);
	}

	:global([data-theme="light"]) .lang-menu {
		background: rgba(255, 255, 255, 0.95);
	}

	:global([data-theme="light"]) .lang-option:hover {
		background: rgba(0, 0, 0, 0.05);
	}
</style>
