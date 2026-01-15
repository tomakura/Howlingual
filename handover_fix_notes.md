# Quick/Main Handover Fix Notes

## Context
- The quick window and main window were both consuming `handover_data` and `get_handover_text`.
- Pending handover data in the main window was treated as plain text, so full translation state was lost.
- When full state was restored through `handleHandover`, translation items lacked `id`, which can break keyed UI rendering.
- Full-state restore did not update `lastTranslatedText`, which could immediately clear explanations.

## Changes
1. Limit handover processing to the main flow
   - Removed the extra `handover_data` listener and `get_handover_text` check from the service-sync mount.
   - This prevents the compact window from consuming main-window handover data.

2. Parse pending handover data as full state in the main window
   - Main mode now routes pending handover text through `handleHandover` so JSON payloads restore full state.

3. Centralize and harden handover restoration logic
   - `handleHandover` now:
     - Restores `lastTranslatedText` to avoid explanation resets.
     - Maps translations with `id` for stable keyed rendering.
     - Uses `applySourceLangFromSync` to keep auto-detect flags consistent.
     - Normalizes `styleLevels` and merges `techMetrics` safely.
     - Triggers `request_sync_state` after restoring full state.

## Files Updated
- `src/routes/+page.svelte`

## Verification Notes
- Handover event and pending handover should only be consumed by the main window now.
- JSON payloads from quick-to-main should restore translations, explanations, and metrics without losing IDs.
- Explanations should remain visible after handover (no immediate reset).

---

# Streaming Stall + Provider Support Notes

## Context
- Streaming requests could continue after a stop, and late updates from the prior request could overwrite the next run.
- That produced a state where tech metrics showed wait time stuck, no output appeared, and a restart surfaced old results.
- Additional providers (Groq/Cerebras) were requested.

## Changes
1. Stop command now cancels active streams
   - Added a `stop_translation_command` listener in the background service.
   - Cancels the active run, clears timers, and broadcasts the stopped state.

2. Guard against late stream updates
   - Each translation run now has a `runId`, and updates are ignored if they don’t match the active run.
   - Prevents old stream results from surfacing after a stop + restart.

3. Add streaming support for Groq and Cerebras
   - Providers are routed through OpenAI-compatible streaming with dedicated base URLs.
   - Added new API key fields and provider selection in settings.
   - Added model lists for Groq/Cerebras and wired provider through the request payload.

## Files Updated
- `src/routes/service/+page.svelte`
- `src/lib/ai_service.ts`
- `src/routes/+page.svelte`
- `src/lib/i18n.ts`

## Verification Notes
- Start a translation, then stop quickly; no late results should appear after restart.
- Groq/Cerebras should stream translations with their API keys set.

## Follow-up: Quick/Main Streaming Sync
- Relaxed the echo guard so active translations (or any non-empty results) can update even if the textarea is focused.
- This restores real-time mirroring across quick/main while still avoiding stale echoes during typing-only phases.

## Follow-up: Route All Streaming Through Service
- Removed direct in-window streaming and always emit `start_translation_command`.
- Ensures quick/main both receive the same `translation_update` stream.

## UI Tweaks
- Compact tech info now renders in two lines (timing on line 1, model/tokens on line 2).
- Removed the fixed right-edge favorite button in the main window.
- Added a sparkle pop animation for favorite button presses.
