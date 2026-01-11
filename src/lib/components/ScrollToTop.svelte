<script lang="ts">
	import { fade } from "svelte/transition";
	import { t, type AppLanguage } from "$lib/i18n";

	let {
		visible = false,
		appLanguage = "ja" as AppLanguage,
		onClick,
	}: {
		visible?: boolean;
		appLanguage?: AppLanguage;
		onClick: () => void;
	} = $props();
</script>

{#if visible}
	<button
		class="scroll-to-top"
		onclick={onClick}
		aria-label={t(appLanguage, "scrollToTop")}
		transition:fade={{ duration: 200 }}
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
			<path d="m18 15-6-6-6 6" />
		</svg>
		{t(appLanguage, "scrollToTop")}
	</button>
{/if}

<style>
	.scroll-to-top {
		position: sticky;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		background: rgba(59, 130, 246, 0.9);
		color: white;
		border: none;
		border-radius: 20px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		transition:
			background 0.2s,
			transform 0.2s;
		z-index: 50;
	}

	.scroll-to-top:hover {
		background: rgba(59, 130, 246, 1);
		transform: translateX(-50%) translateY(-2px);
	}

	.scroll-to-top:active {
		transform: translateX(-50%) translateY(0);
	}
</style>
