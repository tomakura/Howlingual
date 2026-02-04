import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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
const timeoutMs = Number(getArgValue("--timeout-ms", "60000"));
const model = "qwen-3-235b-a22b-instruct-2507";
const prompt = "The quick brown fox jumps over the lazy dog.";

const env = {
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

function getErrorStatus(err) {
	if (!err || typeof err !== "object") return undefined;
	return err.status ?? err.statusCode ?? err.response?.status ?? err.error?.status;
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

async function runStream(translateTextStream) {
	const start = hrNow();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let updates = 0;
	let firstUpdate = null;
	let lastUsage = null;
	let lastResponse = null;
	try {
		await translateTextStream(
			prompt,
			"English",
			"日本語",
			{},
			model,
			(partial, usage) => {
				updates += 1;
				if (firstUpdate === null) firstUpdate = hrNow() - start;
				if (usage) lastUsage = usage;
				if (partial && Object.keys(partial).length > 0) {
					lastResponse = { ...lastResponse, ...partial };
				}
			},
			"日本語",
			{},
			{ cerebras: env.CEREBRAS_API_KEY },
			{ provider: "cerebras", signal: controller.signal },
			1,
		);
		return {
			ok: true,
			latency_ms: Math.round(hrNow() - start),
			first_update_ms: firstUpdate === null ? null : Math.round(firstUpdate),
			updates,
			usage: lastUsage,
			text: lastResponse?.candidates?.[0]?.text || "",
		};
	} catch (err) {
		return {
			ok: false,
			error: String(err),
			status: getErrorStatus(err),
		};
	} finally {
		clearTimeout(timer);
	}
}

async function runNonStream(translateText) {
	const start = hrNow();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await translateText(
			prompt,
			"English",
			"日本語",
			{},
			model,
			{},
			1,
			{
				provider: "cerebras",
				apiKeys: { cerebras: env.CEREBRAS_API_KEY },
				explanationLang: "日本語",
				signal: controller.signal,
			},
		);
		return {
			ok: true,
			latency_ms: Math.round(hrNow() - start),
			usage: res.usage || null,
			text: res.candidates?.[0]?.text || "",
		};
	} catch (err) {
		return {
			ok: false,
			error: String(err),
			status: getErrorStatus(err),
		};
	} finally {
		clearTimeout(timer);
	}
}

async function main() {
	if (!env.CEREBRAS_API_KEY) {
		console.error("CEREBRAS_API_KEY missing");
		process.exit(1);
	}
	ensureDir(outDir);
	const { translateTextStream, translateText } = await loadAiService();

	const report = {
		timestamp: now.toISOString(),
		model,
		mode: "stream+nonstream",
		results: {
			stream: await runStream(translateTextStream),
			nonstream: await runNonStream(translateText),
		},
	};

	const jsonPath = path.join(outDir, `cerebras_ai_service_${timestamp}.json`);
	fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
	console.log(`Report written: ${jsonPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
