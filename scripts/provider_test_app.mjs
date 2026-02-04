import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const loadEnvFromFile = (filePath) => {
	if (!fs.existsSync(filePath)) return;
	const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
	for (const line of lines) {
		if (!line || line.trim().startsWith("#")) continue;
		const idx = line.indexOf("=");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (key && !(key in process.env)) {
			process.env[key] = value;
		}
	}
};

loadEnvFromFile(path.join(process.cwd(), ".env"));

const getArgValue = (name, fallback) => {
	const idx = process.argv.indexOf(name);
	if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
	return fallback;
};

const outDir = getArgValue("--out", "reports");
const prompt = getArgValue(
	"--prompt",
	"The quick brown fox jumps over the lazy dog.",
);
const sourceLang = getArgValue("--source", "English");
const targetLang = getArgValue("--target", "日本語");
const explanationLang = getArgValue("--explain", "日本語");
const candidateCount = Number(getArgValue("--candidates", "1"));
const timeoutMs = Number(getArgValue("--timeout-ms", "60000"));
const anthropicDisplayName = getArgValue(
	"--anthropic-display-name",
	"Claude Sonnet 4.5",
);
const anthropicModelOverride = getArgValue("--anthropic-model-id", "");

const env = {
	OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
	GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
	ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
	GROQ_API_KEY: process.env.GROQ_API_KEY || "",
	CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY || "",
};

const now = new Date();
const timestamp = now
	.toISOString()
	.replace(/[:.]/g, "-")
	.replace("T", "_")
	.replace("Z", "");

const ensureDir = (dir) => {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const hrNow = () => Number(process.hrtime.bigint()) / 1e6;

async function resolveAnthropicModel() {
	if (anthropicModelOverride) return anthropicModelOverride;
	if (!env.ANTHROPIC_API_KEY) return "";
	const res = await fetch("https://api.anthropic.com/v1/models", {
		method: "GET",
		headers: {
			"x-api-key": env.ANTHROPIC_API_KEY,
			"anthropic-version": "2023-06-01",
		},
	});
	if (!res.ok) {
		throw new Error(`Anthropic models list failed: ${res.status} ${res.statusText}`);
	}
	const data = await res.json();
	const list = Array.isArray(data?.data) ? data.data : [];
	const target = anthropicDisplayName.toLowerCase();
	const matched = list.find((m) =>
		String(m.display_name || "").toLowerCase().includes(target),
	);
	return matched?.id || "";
}

async function loadAiService() {
	const entry = path.join(process.cwd(), "src/lib/ai_service.ts");
	const tmpDir = path.join(process.cwd(), ".tmp");
	if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
	const outfile = path.join(tmpDir, `ai_service_bundle_${Date.now()}.mjs`);
	await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		format: "esm",
		platform: "node",
		outfile,
		external: ["openai", "@anthropic-ai/sdk", "@google/generative-ai"],
		define: {
			"import.meta.env": "{}",
		},
	});
	const mod = await import(pathToFileURL(outfile).href);
	return mod;
}

async function runStreamTest({
	name,
	model,
	provider,
	apiKeys,
	translateTextStream,
}) {
	const start = hrNow();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	let firstUpdate = null;
	let updateCount = 0;
	let lastUsage = null;
	let lastResponse = null;

	try {
		await translateTextStream(
			prompt,
			sourceLang,
			targetLang,
			{},
			model,
			(partial, usage) => {
				updateCount += 1;
				if (firstUpdate === null) {
					firstUpdate = hrNow() - start;
				}
				if (usage) lastUsage = usage;
				if (partial && Object.keys(partial).length > 0) {
					lastResponse = { ...lastResponse, ...partial };
				}
			},
			explanationLang,
			{},
			apiKeys,
			{ provider, signal: controller.signal },
			candidateCount,
		);
	} finally {
		clearTimeout(timeout);
	}

	const total = hrNow() - start;
	const text = lastResponse?.candidates?.[0]?.text || "";
	return {
		model,
		ok: true,
		text,
		usage: lastUsage,
		latency_ms: Math.round(total),
		first_update_ms: firstUpdate === null ? null : Math.round(firstUpdate),
		updates: updateCount,
	};
}

async function main() {
	ensureDir(outDir);
	const report = {
		timestamp: now.toISOString(),
		prompt,
		sourceLang,
		targetLang,
		explanationLang,
		candidateCount,
		timeoutMs,
		env_keys_present: {
			openai: Boolean(env.OPENAI_API_KEY),
			gemini: Boolean(env.GEMINI_API_KEY),
			anthropic: Boolean(env.ANTHROPIC_API_KEY),
			groq: Boolean(env.GROQ_API_KEY),
			cerebras: Boolean(env.CEREBRAS_API_KEY),
		},
		results: {},
	};

	const anthropicModel = await resolveAnthropicModel().catch((err) => {
		report.results.anthropic = {
			model: "",
			ok: false,
			error: String(err),
		};
		return "";
	});

	const { translateTextStream } = await loadAiService();

	const tasks = [
		{
			name: "openai",
			provider: "openai",
			model: "gpt-5-mini",
		},
		{
			name: "gemini",
			provider: "gemini",
			model: "gemini-3-flash-preview",
		},
		{
			name: "anthropic",
			provider: "anthropic",
			model: anthropicModel,
		},
		{
			name: "groq",
			provider: "groq",
			model: "openai/gpt-oss-120b",
		},
		{
			name: "cerebras",
			provider: "cerebras",
			model: "qwen-3-235b-a22b-instruct-2507",
		},
	];

	const apiKeys = {
		openai: env.OPENAI_API_KEY,
		google: env.GEMINI_API_KEY,
		gemini: env.GEMINI_API_KEY,
		anthropic: env.ANTHROPIC_API_KEY,
		groq: env.GROQ_API_KEY,
		cerebras: env.CEREBRAS_API_KEY,
	};

	for (const task of tasks) {
		try {
			console.log(`[app-test] start ${task.name}`);
			if (task.name === "anthropic" && !task.model) {
				throw new Error("Anthropic model not resolved");
			}
			const result = await runStreamTest({
				name: task.name,
				model: task.model,
				provider: task.provider,
				apiKeys,
				translateTextStream,
			});
			report.results[task.name] = result;
			console.log(`[app-test] done ${task.name}`);
		} catch (err) {
			report.results[task.name] = {
				model: task.model || task.name,
				ok: false,
				error: String(err),
			};
			console.log(`[app-test] error ${task.name}: ${String(err)}`);
		}
	}

	const jsonPath = path.join(outDir, `provider_test_app_${timestamp}.json`);
	fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

	const lines = [];
	lines.push(`# Provider app-stream test report (${now.toISOString()})`);
	lines.push("");
	lines.push(`Prompt: ${prompt}`);
	lines.push(`Source: ${sourceLang}`);
	lines.push(`Target: ${targetLang}`);
	lines.push(`Explanation: ${explanationLang}`);
	lines.push(`Candidates: ${candidateCount}`);
	lines.push("");
	for (const [name, result] of Object.entries(report.results)) {
		lines.push(`## ${name}`);
		if (result.ok) {
			lines.push(`Model: ${result.model}`);
			lines.push(`Latency (ms): ${result.latency_ms}`);
			lines.push(`First update (ms): ${result.first_update_ms}`);
			lines.push(`Update count: ${result.updates}`);
			lines.push(`Usage: ${JSON.stringify(result.usage)}`);
			lines.push(`Text: ${result.text}`);
		} else {
			lines.push(`Error: ${result.error}`);
		}
		lines.push("");
	}
	const mdPath = path.join(outDir, `provider_test_app_${timestamp}.md`);
	fs.writeFileSync(mdPath, lines.join("\n"), "utf8");

	console.log(`Report written: ${jsonPath}`);
	console.log(`Report written: ${mdPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
