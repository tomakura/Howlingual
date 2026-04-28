import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = process.cwd();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "howlingual-stream-test-"));

async function bundleModule(entry, outfileName, external = []) {
	const outfile = path.join(tmpDir, outfileName);
	await esbuild.build({
		entryPoints: [path.join(root, entry)],
		bundle: true,
		format: "esm",
		platform: "node",
		outfile,
		external,
		define: {
			"import.meta.env": "{}",
		},
	});
	return import(pathToFileURL(outfile).href);
}

const aiService = await bundleModule("src/lib/ai_service.ts", "ai_service.mjs");
const aiModels = await bundleModule("src/lib/ai_models.ts", "ai_models.mjs");

const { parsePartialAiResponseFromStream } = aiService;
const { AI_MODELS, STREAMING_MODELS_BY_PROVIDER } = aiModels;

assert.equal(typeof parsePartialAiResponseFromStream, "function");

const firstChunk = parsePartialAiResponseFromStream(
	`{"detected_source_language":"English","candidates":[{"text":"こんにちは`,
);
assert.equal(firstChunk.detected_source_language, "English");
assert.equal(firstChunk.candidates?.[0]?.text, "こんにちは");

const multiCandidateChunk = parsePartialAiResponseFromStream(
	`{"detected_source_language":"English","candidates":[{"text":"A","reason":"first"},{"text":"B","reason":"second"}`,
);
assert.equal(multiCandidateChunk.candidates?.length, 2);
assert.equal(multiCandidateChunk.candidates?.[1]?.text, "B");
assert.equal(multiCandidateChunk.candidates?.[1]?.reason, "second");

const escapedChunk = parsePartialAiResponseFromStream(
	`{"candidates":[{"text":"Line 1\\n\\"quoted\\"","reason":"uses \\\\ slash"}]}`,
);
assert.equal(escapedChunk.candidates?.[0]?.text, `Line 1\n"quoted"`);
assert.equal(escapedChunk.candidates?.[0]?.reason, "uses \\ slash");

const cappedChunk = parsePartialAiResponseFromStream(
	`{"candidates":[{"text":"one"},{"text":"two"},{"text":"three"}]}`,
	2,
);
assert.deepEqual(
	cappedChunk.candidates?.map((candidate) => candidate.text),
	["one", "two"],
);

const modelValues = new Set(AI_MODELS.map((model) => model.value));
assert.ok(modelValues.has("gpt-5.5"), "OpenAI gpt-5.5 should be visible");
assert.ok(
	STREAMING_MODELS_BY_PROVIDER.openai.includes("gpt-5.5"),
	"OpenAI gpt-5.5 should be stream-enabled",
);
assert.ok(
	modelValues.has("gemini-3.1-pro-preview"),
	"Gemini 3.1 Pro Preview should be visible",
);
assert.ok(
	modelValues.has("gemini-3.1-flash-lite-preview"),
	"Gemini 3.1 Flash-Lite Preview should be visible",
);
assert.equal(
	modelValues.has("gemini-3-pro-preview"),
	false,
	"Stopped Gemini 3 Pro Preview should not be visible",
);
assert.ok(modelValues.has("claude-opus-4-7"), "Claude Opus 4.7 should be visible");
assert.ok(modelValues.has("claude-sonnet-4-6"), "Claude Sonnet 4.6 should be visible");
assert.ok(
	modelValues.has("claude-haiku-4-5-20251001"),
	"Claude Haiku 4.5 should be visible",
);

for (const [provider, streamingModels] of Object.entries(STREAMING_MODELS_BY_PROVIDER)) {
	for (const model of streamingModels) {
		assert.ok(
			modelValues.has(model),
			`${provider} streaming model '${model}' must be present in AI_MODELS`,
		);
	}
}

const groqModels = AI_MODELS
	.filter((model) => model.provider === "groq")
	.map((model) => model.value.toLowerCase());
for (const forbidden of ["whisper", "guard", "tts", "playai"]) {
	assert.equal(
		groqModels.some((model) => model.includes(forbidden)),
		false,
		`Groq translation catalog should not include ${forbidden} models`,
	);
}

console.log("stream parser and model catalog tests passed");
