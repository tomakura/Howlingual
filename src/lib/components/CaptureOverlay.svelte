<script lang="ts">
	import { onMount } from "svelte";
	import { invoke } from "@tauri-apps/api/core";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { fade } from "svelte/transition";

	let isSelecting = $state(false);
	let startX = $state(0);
	let startY = $state(0);
	let currentX = $state(0);
	let currentY = $state(0);

	const queryParams = new URLSearchParams(window.location.search);
	const monitorId = queryParams.get("monitor") ?? "0";

	let selection = $derived.by(() => {
		const x = Math.min(startX, currentX);
		const y = Math.min(startY, currentY);
		const w = Math.abs(currentX - startX);
		const h = Math.abs(currentY - startY);
		return { x, y, w, h };
	});

	async function handleMouseDown(e: MouseEvent) {
		// Only left click
		if (e.button !== 0) return;

		window.focus(); // Ensure window has focus for keyboard events

		isSelecting = true;
		startX = e.clientX;
		startY = e.clientY;
		currentX = e.clientX;
		currentY = e.clientY;
	}

	function handleMouseMove(e: MouseEvent) {
		if (!isSelecting) return;
		currentX = e.clientX;
		currentY = e.clientY;
	}

	let isProcessing = $state(false);

	async function handleMouseUp() {
		if (!isSelecting) return;
		isSelecting = false;

		// Minimum size check (e.g. 10x10)
		if (selection.w < 10 || selection.h < 10) {
			return;
		}

		isProcessing = true;

		try {
			const scale = window.devicePixelRatio || 1;
			const result = await invoke<string>("finish_selection_ocr", {
				monitor_id: monitorId,
				x: Math.round(selection.x * scale),
				y: Math.round(selection.y * scale),
				width: Math.round(selection.w * scale),
				height: Math.round(selection.h * scale),
			});

			await invoke("handover_to_main", { text: result });
		} catch (e) {
			console.error("[Capture] OCR Failed:", e);
			await invoke("handover_to_main", { text: "Error: " + String(e) });
		} finally {
			// Window will likely be closed by backend, but ensure state reset if not
			isProcessing = false;
		}
	}

	async function handleKeyDown(e: KeyboardEvent) {
		console.log("[Capture] Keydown:", e.key);
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			console.log("[Capture] Closing window via Escape");
			try {
				await invoke("cancel_selection_ocr");
			} catch (err) {
				console.error("[Capture] Error canceling OCR:", err);
			} finally {
				getCurrentWindow().close();
			}
		}
	}

	onMount(() => {
		// Ensure transparent background for this window
		const originalHtmlBg = document.documentElement.style.background;
		const originalBodyBg = document.body.style.background;
		const originalHtmlBackdrop = document.documentElement.style.backdropFilter;
		const originalBodyBackdrop = document.body.style.backdropFilter;

		document.documentElement.style.setProperty(
			"background",
			"transparent",
			"important",
		);
		document.body.style.setProperty(
			"background",
			"transparent",
			"important",
		);
		document.documentElement.style.backdropFilter = "none";
		document.body.style.backdropFilter = "none";

		// Focus for Keyboard Events
		setTimeout(() => {
			window.focus();
			console.log("[Capture] Window focused");
		}, 100);

		window.addEventListener("keydown", handleKeyDown, true);

		return () => {
			document.documentElement.style.background = originalHtmlBg;
			document.body.style.background = originalBodyBg;
			document.documentElement.style.backdropFilter = originalHtmlBackdrop;
			document.body.style.backdropFilter = originalBodyBackdrop;
			window.removeEventListener("keydown", handleKeyDown, true);
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="application"
	class="overlay"
	onmousedown={handleMouseDown}
	onmousemove={handleMouseMove}
	onmouseup={handleMouseUp}
	transition:fade={{ duration: 150 }}
>
	<div class="dim-bg"></div>

	{#if isSelecting || (selection.w > 0 && selection.h > 0)}
		<div
			class="selection-box"
			class:processing={isProcessing}
			style:left="{selection.x}px"
			style:top="{selection.y}px"
			style:width="{selection.w}px"
			style:height="{selection.h}px"
		>
			{#if isProcessing}
				<div class="loading-indicator">
					<div class="spinner"></div>
					<span>Reading text...</span>
				</div>
			{:else}
				<div class="size-label">
					{Math.round(selection.w)} x {Math.round(selection.h)}
				</div>
			{/if}
		</div>
	{/if}

	{#if !isSelecting && selection.w === 0 && !isProcessing}
		<div class="hint-container" transition:fade>
			<div class="hint-box">
				<div class="mouse-icon"></div>
				<span>Select area to translate</span>
			</div>
			<div class="cancel-hint">Press <kbd>Esc</kbd> to cancel</div>
		</div>
	{/if}
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		cursor: crosshair;
		z-index: 9999;
		user-select: none;
		font-family: "Inter", sans-serif;
	}

	.dim-bg {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
	}

	.selection-box {
		position: absolute;
		border: 1px solid rgba(255, 255, 255, 0.8);
		/* Simple solid border, visually clean */
		background: rgba(255, 255, 255, 0.08);
		box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55); /* Darkens outside */
		pointer-events: none;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.selection-box.processing {
		border-color: var(--primary-color, #4facfe);
		background: rgba(0, 0, 0, 0.2);
	}

	/* Fixed style block */
	.size-label {
		position: absolute;
		bottom: -24px;
		left: 0;
		background: #333;
		color: #fff;
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 10px;
		opacity: 0.8;
	}

	/* Hint Styling */
	.hint-container {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		pointer-events: none;
	}

	.hint-box {
		background: rgba(0, 0, 0, 0.75);
		/* backdrop-filter removed to prevent blur issues */
		padding: 12px 20px;
		border-radius: 12px;
		color: white;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 10px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.cancel-hint {
		color: rgba(255, 255, 255, 0.7);
		font-size: 13px;
	}

	kbd {
		background: rgba(255, 255, 255, 0.2);
		padding: 2px 6px;
		border-radius: 4px;
		font-family: inherit;
		color: white;
	}

	/* Loading */
	.loading-indicator {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		color: white;
		font-size: 12px;
		font-weight: 600;
		text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 3px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
