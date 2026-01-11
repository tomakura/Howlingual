<script lang="ts">
	let {
		message,
	}: {
		message: string;
	} = $props();
</script>

{#if message}
	<div class="error-display">
		<svg
			class="error-icon"
			xmlns="http://www.w3.org/2000/svg"
			width="32"
			height="32"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="12" cy="12" r="10" />
			<line x1="12" x2="12" y1="8" y2="12" />
			<line x1="12" x2="12.01" y1="16" y2="16" />
		</svg>
		<p class="error-message">{message}</p>
	</div>
{/if}

<style>
	.error-display {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 32px 16px;
		text-align: center;
		color: #f87171;
		background: rgba(248, 113, 113, 0.1);
		border-radius: var(--radius-md);
		border: 1px solid rgba(248, 113, 113, 0.2);
		margin-top: 10px;
		animation: fadeIn 0.3s ease-out;
	}

	.error-icon {
		color: #f87171;
		animation: rotateIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
	}

	@keyframes rotateIn {
		0% {
			opacity: 0;
			transform: rotate(-90deg) scale(0.5);
		}
		60% {
			transform: rotate(20deg) scale(1.1);
		}
		100% {
			opacity: 1;
			transform: rotate(0) scale(1);
		}
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-5px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.error-message {
		font-size: 14px;
		line-height: 1.5;
		white-space: pre-line;
	}
</style>
