<script lang="ts">
	import type { StyleDefinition, StyleLevels } from "$lib/types";
	import { t, getStyleName, type AppLanguage } from "$lib/i18n";

	// Props
	let {
		style,
		level = 0,
		appLanguage = "ja" as AppLanguage,
		isCompactMode = false,
		onCycle,
		onDrag,
	}: {
		style: StyleDefinition;
		level?: number;
		appLanguage?: AppLanguage;
		isCompactMode?: boolean;
		onCycle: (styleName: string) => void;
		onDrag?: (styleName: string, event: PointerEvent) => void;
	} = $props();

	let isDragging = false;

	function handleClick() {
		if (!isDragging) {
			onCycle(style.name);
		}
	}

	function handlePointerDown(event: PointerEvent) {
		if (onDrag) {
			isDragging = false;
			onDrag(style.name, event);
		}
	}

	// Calculate fill width based on level
	let fillWidth = $derived(level === 0 ? "0%" : level === 1 ? "50%" : "100%");

	// Get localized style name
	let displayName = $derived(getStyleName(appLanguage, style.name));
</script>

<button
	class="style-chip"
	class:compact={isCompactMode}
	data-level={level}
	onclick={handleClick}
	onpointerdown={handlePointerDown}
	aria-label={`${displayName}: ${level === 0 ? "オフ" : level === 1 ? "弱" : "強"}`}
>
	<div class="chip-fill" style="width: {fillWidth}"></div>
	<span class="chip-text">{displayName}</span>
</button>

<style>
	.style-chip {
		position: relative;
		display: flex;
		align-items: center;
		padding: 5px 12px;
		border-radius: 8px;
		font-size: 11px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(255, 255, 255, 0.04);
		cursor: pointer;
		overflow: hidden;
		transition: border-color 0.2s;
		user-select: none;
		touch-action: none;
		white-space: nowrap;
	}

	.style-chip:hover {
		border-color: rgba(255, 255, 255, 0.2);
	}

	.style-chip.compact {
		padding: 4px 10px;
		font-size: 10px;
	}

	.chip-fill {
		position: absolute;
		left: 0;
		top: 0;
		height: 100%;
		background: var(--primary-color);
		opacity: 0.15;
		transition:
			width 0.2s cubic-bezier(0.2, 0, 0.2, 1),
			background-color 0.2s;
		border-radius: 8px 0 0 8px;
	}

	.style-chip[data-level="1"] .chip-fill {
		background: var(--primary-color);
		opacity: 0.2;
	}

	.style-chip[data-level="2"] .chip-fill {
		background: var(--primary-color);
		opacity: 0.4;
	}

	.chip-text {
		position: relative;
		z-index: 1;
		color: var(--text-main);
	}

	/* Light mode */
	:global([data-theme="light"]) .style-chip {
		border-color: rgba(0, 0, 0, 0.1);
		background: rgba(0, 0, 0, 0.03);
	}

	:global([data-theme="light"]) .style-chip:hover {
		border-color: rgba(0, 0, 0, 0.2);
	}
</style>
