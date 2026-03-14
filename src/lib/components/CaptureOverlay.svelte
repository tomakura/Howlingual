<script lang="ts">
	import { onMount } from "svelte";
	import { invoke } from "@tauri-apps/api/core";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { fade } from "svelte/transition";
	import { t, type AppLanguage } from "$lib/i18n";

	let { appLanguage = "ja" }: { appLanguage?: AppLanguage } = $props();

	let isSelecting = $state(false);
	let startX = $state(0);
	let startY = $state(0);
	let currentX = $state(0);
	let currentY = $state(0);

	const queryParams = new URLSearchParams(window.location.search);
	const monitorId = queryParams.get("monitor") ?? "0";

	// Constants for DPI scaling verification
	const SCALING_TOLERANCE_PX = 10; // Allow 10px difference for window decorations/rounding

	// Helper to get device pixel ratio with fallback
	function getDevicePixelRatio(): number {
		return window.devicePixelRatio || 1;
	}

	let selection = $derived.by(() => {
		const x = Math.min(startX, currentX);
		const y = Math.min(startY, currentY);
		const w = Math.abs(currentX - startX);
		const h = Math.abs(currentY - startY);
		return { x, y, w, h };
	});

	async function handleMouseDown(e: MouseEvent) {
		console.log("[Capture] Mouse DOWN", e.button, e.clientX, e.clientY);
		if (e.button !== 0) return;
		window.focus();
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
	let isCancelled = $state(false);

	async function handleMouseUp() {
		if (!isSelecting) return;
		isSelecting = false;

		// Minimum size check (e.g. 10x10)
		if (selection.w < 10 || selection.h < 10) {
			return;
		}

		isProcessing = true;

		try {
			// DPI Scaling Explanation:
			// - The capture window is sized in physical pixels (from monitor.width/height)
			// - The webview inside reports dimensions in CSS pixels (physical / devicePixelRatio)
			// - Mouse events (e.clientX/Y) are in CSS pixels
			// - The captured screenshot is in physical pixels
			// - Therefore, we must scale CSS pixel coordinates by devicePixelRatio
			//   to match the physical pixel coordinates of the screenshot
			//
			// Example on 150% DPI (devicePixelRatio = 1.5):
			// - Physical monitor: 1920x1080px
			// - Webview reports: 1280x720px CSS (1920/1.5 x 1080/1.5)
			// - Mouse at CSS (100, 100) → Physical (150, 150)
			// - Screenshot is 1920x1080px, so we crop at physical (150, 150)

			const scale = getDevicePixelRatio();
			console.log(
				"[Capture] Selection:",
				selection.w,
				"x",
				selection.h,
				"Scale:",
				scale,
			);

			const result = await invoke<string>("finish_selection_ocr", {
				monitorId: monitorId,
				x: Math.round(selection.x * scale),
				y: Math.round(selection.y * scale),
				width: Math.round(selection.w * scale),
				height: Math.round(selection.h * scale),
			});

			// Only send result if not cancelled by user
			if (!isCancelled) {
				await invoke("complete_ocr_flow", { text: result });
			}
		} catch (e) {
			console.error("[Capture] OCR Failed:", e);
			// Don't send error to main window if user cancelled
			if (!isCancelled) {
				// Prevent "reappearing" loop on error (e.g. Mac not supported yet)
				console.log("[Capture] OCR failed, closing window.");
				try {
					await invoke("cancel_selection_ocr");
				} catch (err) {
					console.error("[Capture] Error canceling OCR:", err);
				} finally {
					getCurrentWindow().close();
				}
			}
		} finally {
			isProcessing = false;
		}
	}

	async function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			console.log("[Capture] Closing window via Escape");

			// Mark as cancelled to prevent error messages from being sent
			isCancelled = true;

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
		console.log("[Capture] Mounted monitor:", monitorId);
		// Ensure transparent background for this window
		const originalHtmlBg = document.documentElement.style.background;
		const originalBodyBg = document.body.style.background;
		const originalHtmlBackdrop =
			document.documentElement.style.backdropFilter;
		const originalBodyBackdrop = document.body.style.backdropFilter;

		// Apply robust check styles via JS too
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

		// Log DPI/scaling information for debugging
		console.log(
			"[Capture] Window inner size:",
			window.innerWidth,
			"x",
			window.innerHeight,
		);

		// Verify DPI scaling is working as expected
		// Some platforms size capture windows in logical points, others in physical pixels.
		// Accept whichever expected size is closer to the actual inner size.
		const scale = getDevicePixelRatio();
		const expectedInnerWidthPhysical = Math.round(
			window.outerWidth / scale,
		);
		const expectedInnerHeightPhysical = Math.round(
			window.outerHeight / scale,
		);
		const expectedInnerWidthLogical = Math.round(window.outerWidth);
		const expectedInnerHeightLogical = Math.round(window.outerHeight);
		const widthDiff = Math.min(
			Math.abs(window.innerWidth - expectedInnerWidthPhysical),
			Math.abs(window.innerWidth - expectedInnerWidthLogical),
		);
		const heightDiff = Math.min(
			Math.abs(window.innerHeight - expectedInnerHeightPhysical),
			Math.abs(window.innerHeight - expectedInnerHeightLogical),
		);

		if (
			widthDiff > SCALING_TOLERANCE_PX ||
			heightDiff > SCALING_TOLERANCE_PX
		) {
			console.warn(
				`[Capture] Warning: Window scaling may not be working as expected! ` +
					`Expected CSS size (physical): ${expectedInnerWidthPhysical} x ${expectedInnerHeightPhysical}, ` +
					`Expected CSS size (logical): ${expectedInnerWidthLogical} x ${expectedInnerHeightLogical}, ` +
					`Actual CSS size: ${window.innerWidth} x ${window.innerHeight}, ` +
					`Difference: ${widthDiff} x ${heightDiff}`,
			);
		}

		// Focus for Keyboard Events
		setTimeout(() => {
			window.focus();
		}, 100);

		window.addEventListener("keydown", handleKeyDown, true);

		return () => {
			document.documentElement.style.background = originalHtmlBg;
			document.body.style.background = originalBodyBg;
			document.documentElement.style.backdropFilter =
				originalHtmlBackdrop;
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
	{#if (!isSelecting || selection.w < 2 || selection.h < 2) && !isProcessing}
		<div class="dim-bg" transition:fade={{ duration: 150 }}></div>
	{/if}

	{#if (isSelecting || isProcessing) && selection.w >= 2 && selection.h >= 2}
		<div
			class="selection-box"
			class:processing={isProcessing}
			class:starting={selection.w < 2 || selection.h < 2}
			style:left="{selection.x}px"
			style:top="{selection.y}px"
			style:width="{selection.w}px"
			style:height="{selection.h}px"
		>
			{#if isProcessing}
				<div class="loading-indicator">
					<div class="spinner"></div>
					<span>{t(appLanguage, "ocrReading")}</span>
				</div>
			{:else if selection.w > 20 && selection.h > 20}
				<div class="size-label">
					{Math.round(selection.w)} x {Math.round(selection.h)}
				</div>
			{/if}
		</div>
	{/if}

	{#if !isSelecting && !isProcessing}
		<div class="hint-container" transition:fade>
			<div class="hint-box">
				<div class="mouse-icon"></div>
				<span>{t(appLanguage, "ocrHint")}</span>
			</div>
			<div class="cancel-hint">{t(appLanguage, "ocrCancelHint")}</div>
		</div>
	{/if}
</div>

<style>
	:global(html),
	:global(body) {
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	.overlay {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		cursor: crosshair;
		z-index: 2147483647; /* Max z-index */
		user-select: none;
		font-family: "Inter", sans-serif;
		background: transparent;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	.dim-bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.45) !important;
		opacity: 1 !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		z-index: 1;
	}

	.selection-box {
		position: absolute;
		border: 1px solid rgba(255, 255, 255, 0.8) !important;
		/* Simple solid border, visually clean */
		background: rgba(255, 255, 255, 0.1) !important;
		box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45) !important; /* Darkens outside */
		pointer-events: none;
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 2147483647;
	}

	.selection-box.starting {
		border: none !important;
		background: transparent !important;
		box-shadow: none !important;
	}

	.selection-box.processing {
		border-color: var(--primary-color, #4facfe) !important;
		background: rgba(0, 0, 0, 0.2) !important;
		box-shadow: none !important;
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
		z-index: 2147483647;
	}

	.hint-box {
		background: rgba(0, 0, 0, 0.85) !important;
		/* backdrop-filter removed to prevent blur issues */
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		padding: 12px 20px;
		border-radius: 12px;
		color: white !important;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 10px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
		border: 1px solid rgba(255, 255, 255, 0.2) !important;
	}

	.cancel-hint {
		color: rgba(255, 255, 255, 0.8) !important;
		font-size: 13px;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
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
