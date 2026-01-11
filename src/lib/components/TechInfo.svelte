<script lang="ts">
	import type { TechMetrics } from "$lib/types";
	import { formatDuration, formatTokensPerSec } from "$lib/utils";

	let {
		metrics,
		isCompactMode = false,
	}: {
		metrics: TechMetrics;
		isCompactMode?: boolean;
	} = $props();

	let hasValidMetrics = $derived(metrics.time > 0 || metrics.inputTokens > 0);
</script>

{#if hasValidMetrics}
	<div class="tech-info-display" class:compact={isCompactMode}>
		<span class="tech-item">
			<span class="tech-label">⏱</span>
			<span class="tech-value">{formatDuration(metrics.time)}s</span>
		</span>

		{#if metrics.waitTime > 0}
			<span class="tech-divider">|</span>
			<span class="tech-item">
				<span class="tech-label">待機</span>
				<span class="tech-value">{formatDuration(metrics.waitTime)}s</span>
			</span>
		{/if}

		{#if metrics.genTime > 0}
			<span class="tech-divider">|</span>
			<span class="tech-item">
				<span class="tech-label">生成</span>
				<span class="tech-value">{formatDuration(metrics.genTime)}s</span>
			</span>
		{/if}

		{#if metrics.inputTokens > 0 || metrics.outputTokens > 0}
			<span class="tech-divider">|</span>
			<span class="tech-item tech-tokens">
				<span class="token-row">
					<span class="tech-label">入力</span>
					<span class="tech-value"
						>{metrics.inputTokens}{metrics.isReal ? "" : "?"}</span
					>
				</span>
				<span class="token-row">
					<span class="tech-label">出力</span>
					<span class="tech-value">{metrics.outputTokens}</span>
				</span>
			</span>
		{/if}

		{#if metrics.tokensPerSec > 0}
			<span class="tech-divider">|</span>
			<span class="tech-item">
				<span class="tech-label">tok/s</span>
				<span class="tech-value">{formatTokensPerSec(metrics.tokensPerSec)}</span>
			</span>
		{/if}

		{#if metrics.model}
			<span class="tech-divider">|</span>
			<span class="tech-item">
				<span class="tech-value model-name">{metrics.model}</span>
			</span>
		{/if}
	</div>
{/if}

<style>
	.tech-info-display {
		margin-top: 6px;
		margin-bottom: 12px;
		display: flex;
		justify-content: center;
		gap: 10px;
		font-size: 10px;
		color: var(--text-muted);
		opacity: 0.8;
		align-items: center;
	}

	.tech-info-display.compact {
		flex-wrap: wrap;
		justify-content: center;
		gap: 5px;
		font-size: 10px;
		align-items: center;
		white-space: normal;
		overflow: visible;
	}

	.tech-item {
		display: flex;
		gap: 4px;
	}

	.tech-label {
		font-weight: 500;
		opacity: 0.7;
	}

	.tech-value {
		font-weight: 500;
	}

	.tech-divider {
		opacity: 0.3;
	}

	.tech-info-display.compact .tech-divider {
		display: inline;
		opacity: 0.4;
	}

	.tech-info-display.compact .tech-item {
		white-space: nowrap;
	}

	.tech-tokens {
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		line-height: 1.3;
	}

	.token-row {
		display: flex;
		gap: 4px;
	}

	.model-name {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
