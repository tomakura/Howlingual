<script lang="ts">
	import type { DetailedExplanation } from "$lib/types";
	import { t, type AppLanguage } from "$lib/i18n";

	let {
		explanation,
		appLanguage = "ja" as AppLanguage,
	}: {
		explanation: DetailedExplanation;
		appLanguage?: AppLanguage;
	} = $props();
</script>

{#if explanation && explanation.points && explanation.points.length > 0}
	<div class="explanation-card">
		<h3>
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
				<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
				<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
			</svg>
			{t(appLanguage, "explanation")}
		</h3>
		<ul class="explanation-list">
			{#each explanation.points as point}
				<li>
					<strong>{point.term}</strong>: {point.explanation}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.explanation-card {
		padding: 12px 12px;
		border-radius: var(--radius-sm);
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
	}

	h3 {
		font-size: 12px;
		margin-bottom: 8px;
		color: var(--text-muted);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.explanation-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.explanation-list li {
		font-size: 12px;
		line-height: 1.5;
		color: #b0b0b0;
	}

	.explanation-list strong {
		color: var(--primary-hover);
		font-weight: 500;
	}

	:global([data-theme="light"]) .explanation-card {
		background: rgba(0, 0, 0, 0.03);
		border-color: rgba(0, 0, 0, 0.08);
	}

	:global([data-theme="light"]) .explanation-list li {
		color: #555;
	}
</style>
