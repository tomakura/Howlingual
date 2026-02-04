import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, ".env");

if (!fs.existsSync(envPath)) {
  console.error(".env not found at", envPath);
  process.exit(1);
}

const raw = fs.readFileSync(envPath, "utf8");

function parseEnvLine(name) {
  const match = raw.match(new RegExp(`^${name}=(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function parseJsonLine(name) {
  const text = parseEnvLine(name);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const apiKeys = parseJsonLine("apiKeys") || {};
const lastSelectedModels = parseJsonLine("lastSelectedModels") || {};

const args = new Set(process.argv.slice(2));
const providers = args.has("--groq") || args.has("--cerebras")
  ? [args.has("--groq") ? "groq" : null, args.has("--cerebras") ? "cerebras" : null].filter(Boolean)
  : ["groq", "cerebras"];

const useJsonMode = args.has("--json");
const useNoJsonMode = args.has("--no-json");

const modes = (useJsonMode || useNoJsonMode)
  ? [useJsonMode ? "json" : null, useNoJsonMode ? "no_json" : null].filter(Boolean)
  : ["json", "no_json"];

function buildClient(key, baseURL) {
  return new OpenAI({ apiKey: key, baseURL, dangerouslyAllowBrowser: true });
}

function buildPrompt() {
  return `Translate to Japanese. Output valid JSON with detected_source_language, candidates (3), and detailed_explanation.\n\n` +
    `Paragraph 1: This is a long paragraph designed to force a large output. It includes multiple sentences, varied punctuation, and requires careful translation into natural Japanese while preserving nuance and style.\n\n` +
    `Paragraph 2: The goal is to test streaming behavior over an extended response, so please keep each candidate reasonably detailed and include an explanation for each choice.\n\n` +
    `Paragraph 3: Add a short technical explanation section with a few terms and definitions in Japanese.`;
}

async function runVariant(provider, mode) {
  const key = apiKeys[provider];
  if (!key) {
    console.log(`[probe] ${provider}: skipped (no key)`);
    return;
  }

  let baseURL = undefined;
  let model = lastSelectedModels[provider];
  if (provider === "groq") {
    baseURL = "https://api.groq.com/openai/v1";
    model = model || "openai/gpt-oss-120b";
  } else if (provider === "cerebras") {
    baseURL = "https://api.cerebras.ai/v1";
    model = model || "zai-glm-4.7";
  }

  const client = buildClient(key, baseURL);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  const requestParams = {
    model,
    messages: [
      { role: "system", content: "Output strictly valid JSON only." },
      { role: "user", content: buildPrompt() }
    ],
    stream: true
  };

  if (mode === "json") {
    requestParams.response_format = { type: "json_object" };
  }

  console.log(`[probe] ${provider}/${model} mode=${mode}: start`);
  const start = Date.now();
  let firstChunkAt = 0;
  let chunks = 0;
  let contentChars = 0;

  try {
    const stream = await client.chat.completions.create(requestParams, { signal: controller.signal });
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        if (!firstChunkAt) firstChunkAt = Date.now();
        contentChars += delta.length;
      }
      chunks += 1;
      if (chunks % 50 === 0) {
        const now = Date.now();
        console.log(`[probe] ${provider}/${model} mode=${mode}: chunks=${chunks} chars=${contentChars} t=${((now - start)/1000).toFixed(1)}s`);
      }
    }
    const end = Date.now();
    const ttfb = firstChunkAt ? ((firstChunkAt - start) / 1000).toFixed(2) : "-";
    console.log(`[probe] ${provider}/${model} mode=${mode}: done chunks=${chunks} chars=${contentChars} ttfb=${ttfb}s total=${((end - start)/1000).toFixed(1)}s`);
  } catch (err) {
    const end = Date.now();
    console.log(`[probe] ${provider}/${model} mode=${mode}: error after ${((end - start)/1000).toFixed(1)}s`, err?.message || err);
  } finally {
    clearTimeout(timeoutId);
  }
}

for (const provider of providers) {
  for (const mode of modes) {
    // Run sequentially to keep logs readable
    await runVariant(provider, mode);
  }
}
