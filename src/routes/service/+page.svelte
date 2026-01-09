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
	let timerInterval: any = null;

	// Listeners
	onMount(async () => {
		console.log("[Service] Started background translation service");

		// Listen for translation requests
		await listen("start_translation_command", async (event: any) => {
			const payload = event.payload;
			console.log("[Service] Received start command:", payload);
			await startTranslation(payload);
		});

		// Listen for partial state updates (input, styles)
		await listen("sync_input_command", async (event: any) => {
			const payload = event.payload;
			// console.log("[Service] Sync input:", payload);
			if (payload.text !== undefined) inputQuery = payload.text;
			if (payload.sourceLang !== undefined)
				sourceLang = payload.sourceLang;
			if (payload.targetLang !== undefined)
				targetLang = payload.targetLang;
			if (payload.styles !== undefined) styleLevels = payload.styles;

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

		isTranslating = true;
		inputQuery = params.text;
		sourceLang = params.sourceLang;
		detectedLang = "";
		targetLang = params.targetLang;
		styleLevels = params.styles;
		currentModel = params.model;

		translations = [
			{ id: 1, text: "", reason: "" },
			{ id: 2, text: "", reason: "" },
			{ id: 3, text: "", reason: "" },
		];
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

		const startTime = Date.now();
		if (timerInterval) clearInterval(timerInterval);
		timerInterval = setInterval(() => {
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

		try {
			await translateTextStream(
				params.text,
				params.sourceLang,
				params.targetLang,
				params.styles,
				params.model,
				(partial, usage) => {
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
				params.stylePrompts, // pass stylePrompts if needed, logic in +page.svelte extracted it
				params.apiKeys,
			);
		} catch (e) {
			console.error("[Service] Translation error:", e);
			// Ensure we stop translating state in case of error?
		} finally {
			isTranslating = false;
			if (timerInterval) clearInterval(timerInterval);
			await broadcastUpdate();
		}
	}
</script>

<h1>Howlingual Service</h1>
<p>Background Process Running...</p>
