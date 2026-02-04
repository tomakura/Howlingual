<script lang="ts">
	import { onMount, tick } from "svelte";
	import { listen, emit } from "@tauri-apps/api/event";
	import {
		translateTextStream,
		type AiModel,
		type TranslationResult,
		type UsageMetadata,
	} from "$lib/ai_service";

	// State
	let isTranslating = false;
	let translations: TranslationResult[] = [];
	let detailedExplanation: any = null;
	let inputQuery = "";
	let sourceLang = "自動検出";
	let detectedLang = "";
	let isDetecting = false;
	let targetLang = "英語";
	let styleLevels: Record<string, number> = {};
	let currentModel = "";
	let techMetrics = {
		time: 0,
		waitTime: 0,
		genTime: 0,
		model: "",
		inputTokens: 0,
		outputTokens: 0,
		tokensPerSec: 0,
		isReal: false,
		firstTokenReceived: false,
	};
	let candidateCount = 3;
	let timerInterval: any = null;
	let activeRunId = 0;
	let currentAbortController: AbortController | null = null;
	let stopRequested = false;

	function buildEmptyTranslations(count: number): TranslationResult[] {
		const safeCount = Math.max(1, Math.min(6, Number(count) || 3));
		return Array.from({ length: safeCount }, (_, i) => ({
			id: i + 1,
			text: "",
			reason: "",
		}));
	}

	// Listeners
	onMount(async () => {
		console.log("[Service] Started background translation service");

		// Listen for translation requests
		await listen("start_translation_command", async (event: any) => {
			const payload = event.payload;
			console.log("[Service] Received start command:", payload);
			await startTranslation(payload);
		});

		await listen("stop_translation_command", async () => {
			if (currentAbortController) {
				stopRequested = true;
				currentAbortController.abort();
				currentAbortController = null;
			}
			activeRunId += 1;
			isTranslating = false;
			if (timerInterval) clearInterval(timerInterval);
			await broadcastUpdate();
		});

		// Listen for partial state updates (input, styles)
		await listen("sync_input_command", async (event: any) => {
			const payload = event.payload;
			// console.log("[Service] Sync input:", payload);
			const shouldReset = Boolean(payload.resetTranslations);
			if (payload.candidateCount !== undefined) {
				candidateCount = Math.max(
					1,
					Math.min(6, Number(payload.candidateCount) || 3),
				);
			}
			if (payload.text !== undefined) inputQuery = payload.text;
			if (payload.sourceLang !== undefined)
				sourceLang = payload.sourceLang;
			if (payload.detectedLang !== undefined)
				detectedLang = payload.detectedLang;
			if (payload.isDetecting !== undefined)
				isDetecting = payload.isDetecting;
			if (payload.targetLang !== undefined)
				targetLang = payload.targetLang;
			if (payload.styles !== undefined) styleLevels = payload.styles;

			if (shouldReset && !isTranslating) {
				isTranslating = false;
				detectedLang = "";
				translations = buildEmptyTranslations(candidateCount);
				detailedExplanation = null;
				techMetrics = {
					time: 0,
					waitTime: 0,
					genTime: 0,
					model: currentModel,
					inputTokens: 0,
					outputTokens: 0,
					tokensPerSec: 0,
					isReal: false,
					firstTokenReceived: false,
				};
				if (timerInterval) clearInterval(timerInterval);
			}

			await broadcastUpdate();
		});

		// Listen for state sync requests (when a window opens)
		await listen("request_sync_state", async () => {
			console.log("[Service] Sync requested");
			await broadcastUpdate();
		});
	});

	async function broadcastUpdate() {
		await emit("translation_update", {
			isTranslating,
			translations,
			detailedExplanation,
			techMetrics,
			inputQuery,
			sourceLang,
			detectedLang,
			isDetecting,
			targetLang,
			styleLevels,
			currentModel,
		});
	}

	async function startTranslation(params: any) {
		if (isTranslating) {
			// Cancel previous? For now, we just overwrite
			console.log("[Service] Restarting translation...");
		}

		if (currentAbortController) {
			currentAbortController.abort();
		}
		const runId = activeRunId + 1;
		activeRunId = runId;
		const abortController = new AbortController();
		currentAbortController = abortController;

		isTranslating = true;
		stopRequested = false;
		inputQuery = params.text;
		sourceLang = params.sourceLang;
		detectedLang = "";
		targetLang = params.targetLang;
		styleLevels = params.styles;
		currentModel = params.model;
		candidateCount = Math.max(
			1,
			Math.min(6, Number(params.candidateCount) || candidateCount),
		);

		translations = buildEmptyTranslations(candidateCount);
		detailedExplanation = null;

		// Tech info reset
		techMetrics = {
			time: 0,
			waitTime: 0,
			genTime: 0,
			model: params.model,
			inputTokens: params.initialTokens || 0,
			outputTokens: 0,
			tokensPerSec: 0,
			isReal: false,
			firstTokenReceived: false,
		};
		let hasParsedJson = false;

		const startTime = Date.now();
		if (timerInterval) clearInterval(timerInterval);
		timerInterval = setInterval(() => {
			if (runId !== activeRunId) return;
			techMetrics.time = (Date.now() - startTime) / 1000;
			if (techMetrics.firstTokenReceived) {
				techMetrics.genTime = techMetrics.time - techMetrics.waitTime;
				if (techMetrics.genTime > 0) {
					techMetrics.tokensPerSec =
						techMetrics.outputTokens / techMetrics.genTime;
				}
			} else {
				techMetrics.waitTime = techMetrics.time;
				techMetrics.genTime = 0; // Explicit 0
			}
			broadcastUpdate(); // Periodic time update
		}, 100);

		// Broadcast initial state
		await broadcastUpdate();

		const isMeaningfulUpdate = (partial: any, usage?: UsageMetadata) => {
			if (usage) return true;
			if (!partial) return false;
			if (partial.detected_source_language) return true;
			if (partial.detailed_explanation?.points?.length) return true;
			if (partial.raw_stream_text && String(partial.raw_stream_text).trim()) return true;
			if (Array.isArray(partial.candidates)) {
				return partial.candidates.some((c: any) => c?.text || c?.reason);
			}
			return false;
		};

		let lastMeaningfulAt = Date.now();
		const MAX_TRANSLATION_MS = 180_000;
		const IDLE_TIMEOUT_MS = 30_000;
		let idleTimerId: ReturnType<typeof setInterval> | null = null;
		let hardTimeoutId: ReturnType<typeof setTimeout> | null = null;

		const idlePromise = new Promise<"idle">((resolve) => {
			idleTimerId = setInterval(() => {
				if (Date.now() - lastMeaningfulAt > IDLE_TIMEOUT_MS) {
					resolve("idle");
				}
			}, 1000);
		});

		const hardTimeoutPromise = new Promise<"hard">((resolve) => {
			hardTimeoutId = setTimeout(() => resolve("hard"), MAX_TRANSLATION_MS);
		});

		const streamPromise = translateTextStream(
				params.text,
				params.sourceLang,
				params.targetLang,
				params.styles,
				params.model,
				(partial, usage) => {
					if (runId !== activeRunId) return;
					if (isMeaningfulUpdate(partial, usage)) {
						lastMeaningfulAt = Date.now();
					}
					if (!techMetrics.firstTokenReceived) {
						techMetrics.firstTokenReceived = true;
					}

					if (usage) {
						techMetrics.inputTokens = usage.input_tokens;
						techMetrics.outputTokens = usage.output_tokens;
						techMetrics.isReal = true;
					}

					if (partial.detected_source_language) {
						detectedLang = partial.detected_source_language;
						hasParsedJson = true;
					}

					if (partial.candidates) {
						hasParsedJson = true;
						// Merge candidates carefully
						partial.candidates.forEach((cand, i) => {
							if (translations[i]) {
								translations[i].text =
									cand.text || translations[i].text;
								translations[i].reason =
									cand.reason || translations[i].reason;
							}
						});
					}
					if (partial.detailed_explanation) {
						hasParsedJson = true;
						detailedExplanation = partial.detailed_explanation;
					}
					broadcastUpdate();
				},
				params.explanationLang,
				params.styleMeta, // pass style metadata (id -> {name, prompt})
				params.apiKeys,
				{ provider: params.provider, signal: abortController.signal },
				candidateCount,
			);

		try {
			const winner = await Promise.race([
				streamPromise.then(() => "done" as const),
				idlePromise,
				hardTimeoutPromise,
			]);

			if (winner !== "done") {
				if (!stopRequested) {
					errorMessage =
						winner === "idle"
							? "ストリーミングが停止したため中断しました。"
							: "翻訳がタイムアウトしました。";
				}
				if (currentAbortController) {
					currentAbortController.abort();
				}
			}
		} catch (e) {
			if (!abortController.signal.aborted) {
				console.error("[Service] Translation error:", e);
			}
			// Ensure we stop translating state in case of error?
		} finally {
			if (idleTimerId) clearInterval(idleTimerId);
			if (hardTimeoutId) clearTimeout(hardTimeoutId);
			if (runId === activeRunId) {
				isTranslating = false;
				if (timerInterval) clearInterval(timerInterval);
				await broadcastUpdate();
			}
		}
	}
</script>

<h1>Howlingual Service</h1>
<p>Background Process Running...</p>
