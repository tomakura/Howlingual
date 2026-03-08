<script lang="ts">
	import { onMount, tick } from "svelte";
	import { listen, emit } from "@tauri-apps/api/event";
	import {
		translateText,
		translateTextStream,
		type AiModel,
		type TranslationResult,
		type UsageMetadata,
	} from "$lib/ai_service";
	import { getExecutionPlan } from "$lib/translation_policy";
	import { getProviderForModel, type AiProvider } from "$lib/ai_models";

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
	let errorMessage = "";
	const STREAM_IDLE_TIMEOUT_MS = 120_000;
	let techMetrics = {
		time: 0,
		waitTime: 0,
		genTime: 0,
		model: "",
		inputTokens: 0,
		outputTokens: 0,
		tokensPerSec: 0,
		streamMode: true,
		isReal: false,
		firstTokenReceived: false,
	};
	let candidateCount = 3;
	let timerInterval: any = null;
	let activeRunId = 0;
	let currentAbortController: AbortController | null = null;
	let currentFallbackController: AbortController | null = null;
	const CEREBRAS_MODEL_LIST_TTL_MS = 5 * 60 * 1000;
	let cerebrasModelCache: { at: number; models: string[] } | null = null;

	async function fetchCerebrasModels(apiKey?: string): Promise<string[] | null> {
		const resolvedKey = apiKey || import.meta.env.VITE_CEREBRAS_API_KEY;
		if (!resolvedKey) return null;
		const now = Date.now();
		if (
			cerebrasModelCache &&
			now - cerebrasModelCache.at < CEREBRAS_MODEL_LIST_TTL_MS
		) {
			return cerebrasModelCache.models;
		}
		try {
			const res = await fetch("https://api.cerebras.ai/v1/models", {
				headers: { Authorization: `Bearer ${resolvedKey}` },
			});
			if (!res.ok) {
				console.warn("[Service] Cerebras model list fetch failed:", res.status);
				return null;
			}
			const data = await res.json();
			const models = Array.isArray(data?.data)
				? data.data.map((m: any) => String(m.id))
				: [];
			cerebrasModelCache = { at: now, models };
			return models;
		} catch (err) {
			console.warn("[Service] Cerebras model list error:", err);
			return null;
		}
	}

	function getErrorStatus(err: unknown): number | undefined {
		if (!err || typeof err !== "object") return undefined;
		const anyErr = err as any;
		return (
			anyErr.status ??
			anyErr.statusCode ??
			anyErr.response?.status ??
			anyErr.error?.status ??
			undefined
		);
	}

	function isTranslationComplete(
		items: TranslationResult[],
		explanation: any,
		expectedCount: number,
	) {
		if (!Array.isArray(items) || items.length < expectedCount) return false;
		const required = items.slice(0, expectedCount);
		if (required.some((item) => !item.text || !item.reason)) return false;
		if (!explanation || !Array.isArray(explanation.points)) return false;
		if (explanation.points.length === 0) return false;
		return true;
	}

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
				currentAbortController.abort();
				currentAbortController = null;
			}
			if (currentFallbackController) {
				currentFallbackController.abort();
				currentFallbackController = null;
			}
			activeRunId += 1;
			isTranslating = false;
			errorMessage = "";
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
				errorMessage = "";
				techMetrics = {
					time: 0,
					waitTime: 0,
					genTime: 0,
					model: currentModel,
					inputTokens: 0,
					outputTokens: 0,
					tokensPerSec: 0,
					streamMode: techMetrics.streamMode,
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
			errorMessage,
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
		if (currentFallbackController) {
			currentFallbackController.abort();
			currentFallbackController = null;
		}
		const runId = activeRunId + 1;
		activeRunId = runId;
		const abortController = new AbortController();
		currentAbortController = abortController;
		let streamTimeoutId: ReturnType<typeof setTimeout> | null = null;
		let timedOut = false;
		const resetStreamTimeout = () => {
			if (streamTimeoutId) clearTimeout(streamTimeoutId);
			streamTimeoutId = setTimeout(async () => {
				if (runId !== activeRunId) return;
				console.warn("[Service] Stream timeout");
				timedOut = true;
				abortController.abort();
				await broadcastUpdate();
			}, STREAM_IDLE_TIMEOUT_MS);
		};

		isTranslating = true;
		inputQuery = params.text;
		sourceLang = params.sourceLang;
		detectedLang = "";
		targetLang = params.targetLang;
		styleLevels = params.styles;
		currentModel = params.model;
			errorMessage = "";
			const provider =
				((params.provider as AiProvider | null | undefined) ??
					getProviderForModel(params.model)) ??
				undefined;
		const cerebrasApiKey = params.apiKeys?.cerebras?.trim();
		const executionPlan = getExecutionPlan({
			provider,
			model: params.model,
			streamingDisplay: true,
		});
		const isStreamMode = executionPlan.mode === "stream";
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
			streamMode: isStreamMode,
			isReal: false,
			firstTokenReceived: false,
		};

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
		resetStreamTimeout();

		if (provider === "cerebras" && cerebrasApiKey) {
			const availableModels = await fetchCerebrasModels(cerebrasApiKey);
			if (availableModels && !availableModels.includes(params.model)) {
				isTranslating = false;
				errorMessage =
					"このCerebras APIキーでは選択モデルが利用できません。プレビュー権限やモデル一覧を確認してください。";
				if (timerInterval) clearInterval(timerInterval);
				if (streamTimeoutId) clearTimeout(streamTimeoutId);
				await broadcastUpdate();
				return;
			}
		}

		try {
			await translateTextStream(
				params.text,
				params.sourceLang,
				params.targetLang,
				params.styles,
				params.model,
				(partial, usage) => {
					if (runId !== activeRunId) return;
					resetStreamTimeout();
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
					}

					if (partial.candidates) {
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
						detailedExplanation = partial.detailed_explanation;
					}

					broadcastUpdate();
				},
				params.explanationLang,
				params.styleMeta, // pass style metadata (id -> {name, prompt})
					params.apiKeys,
					{ provider, signal: abortController.signal },
				candidateCount,
			);
			if (
				runId === activeRunId &&
				!abortController.signal.aborted &&
				!isTranslationComplete(translations, detailedExplanation, candidateCount)
			) {
				console.warn("[Service] Incomplete stream result, fallback to non-stream");
				currentFallbackController = new AbortController();
				const response = await translateText(
					params.text,
					params.sourceLang,
					params.targetLang,
					params.styles,
					params.model as AiModel,
					params.styleMeta,
					candidateCount,
					{
						provider,
						apiKeys: params.apiKeys,
						explanationLang: params.explanationLang,
						signal: currentFallbackController.signal,
					},
				);
				if (runId === activeRunId) {
					detectedLang = response.detected_source_language || detectedLang;
					translations = response.candidates.map((c, i) => ({
						id: i + 1,
						text: c.text,
						reason: c.reason,
					}));
					detailedExplanation =
						response.detailed_explanation || detailedExplanation;
					if (response.usage) {
						techMetrics.inputTokens = response.usage.input_tokens;
						techMetrics.outputTokens = response.usage.output_tokens;
						techMetrics.isReal = true;
					}
					errorMessage = "";
					await broadcastUpdate();
				}
			}
		} catch (e) {
			const status = getErrorStatus(e);
			if (
				status === 404 &&
				provider === "cerebras" &&
				runId === activeRunId &&
				!abortController.signal.aborted
			) {
				console.error("[Service] Cerebras model not found:", e);
				errorMessage = String(e);
				await broadcastUpdate();
				return;
			}
			if (timedOut && runId === activeRunId) {
				try {
					console.warn("[Service] Retry after timeout");
					currentFallbackController = new AbortController();
					const response = await translateText(
						params.text,
						params.sourceLang,
						params.targetLang,
						params.styles,
						params.model as AiModel,
						params.styleMeta,
						candidateCount,
						{
							provider,
							apiKeys: params.apiKeys,
							explanationLang: params.explanationLang,
							signal: currentFallbackController.signal,
						},
					);
					if (runId === activeRunId) {
						detectedLang = response.detected_source_language || detectedLang;
						translations = response.candidates.map((c, i) => ({
							id: i + 1,
							text: c.text,
							reason: c.reason,
						}));
						detailedExplanation =
							response.detailed_explanation || detailedExplanation;
						if (response.usage) {
							techMetrics.inputTokens = response.usage.input_tokens;
							techMetrics.outputTokens = response.usage.output_tokens;
							techMetrics.isReal = true;
						}
						errorMessage = "";
						await broadcastUpdate();
					}
				} catch (fallbackError) {
					console.error("[Service] Fallback failed:", fallbackError);
					errorMessage = "ストリームがタイムアウトしました。";
				}
			} else if (!abortController.signal.aborted) {
				console.error("[Service] Translation error:", e);
				errorMessage = String(e);
			}
			// Ensure we stop translating state in case of error?
		} finally {
			if (runId === activeRunId) {
				isTranslating = false;
				if (timerInterval) clearInterval(timerInterval);
				if (streamTimeoutId) clearTimeout(streamTimeoutId);
				if (currentFallbackController) {
					currentFallbackController = null;
				}
				await broadcastUpdate();
			}
		}
	}
</script>

<h1>Howlingual Service</h1>
<p>Background Process Running...</p>
