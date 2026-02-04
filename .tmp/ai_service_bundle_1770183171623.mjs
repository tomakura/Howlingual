// <define:import.meta.env>
var define_import_meta_env_default = {};

// src/lib/ai_service.ts
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// src/lib/ai_models.ts
var AI_MODELS = [
  // OpenAI
  { label: "GPT-5.2", value: "gpt-5.2", provider: "openai" },
  {
    label: "GPT-5.2 Chat (Latest)",
    value: "gpt-5.2-chat-latest",
    provider: "openai"
  },
  { label: "GPT-5.1", value: "gpt-5.1", provider: "openai" },
  {
    label: "GPT-5.1 Chat (Latest)",
    value: "gpt-5.1-chat-latest",
    provider: "openai"
  },
  { label: "GPT-5", value: "gpt-5", provider: "openai" },
  {
    label: "GPT-5 Chat (Latest)",
    value: "gpt-5-chat-latest",
    provider: "openai"
  },
  { label: "GPT-5 Mini", value: "gpt-5-mini", provider: "openai" },
  { label: "GPT-5 Nano", value: "gpt-5-nano", provider: "openai" },
  { label: "GPT-4.1", value: "gpt-4.1", provider: "openai" },
  { label: "GPT-4.1 Mini", value: "gpt-4.1-mini", provider: "openai" },
  { label: "GPT-4.1 Nano", value: "gpt-4.1-nano", provider: "openai" },
  { label: "GPT-4o", value: "gpt-4o", provider: "openai" },
  { label: "GPT-4o Mini", value: "gpt-4o-mini", provider: "openai" },
  { label: "o3", value: "o3", provider: "openai" },
  { label: "o3-mini", value: "o3-mini", provider: "openai" },
  { label: "o1", value: "o1", provider: "openai" },
  { label: "o1-mini", value: "o1-mini", provider: "openai" },
  // Google Gemini
  { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro", provider: "gemini" },
  { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash", provider: "gemini" },
  {
    label: "Gemini 2.5 Flash-Lite",
    value: "gemini-2.5-flash-lite",
    provider: "gemini"
  },
  {
    label: "Gemini 3 Pro Preview",
    value: "gemini-3-pro-preview",
    provider: "gemini"
  },
  {
    label: "Gemini 3 Flash Preview",
    value: "gemini-3-flash-preview",
    provider: "gemini"
  },
  // Anthropic Claude
  {
    label: "Claude Opus 4.1",
    value: "claude-opus-4-1-20250805",
    provider: "anthropic"
  },
  {
    label: "Claude Opus 4",
    value: "claude-opus-4-20250514",
    provider: "anthropic"
  },
  {
    label: "Claude Sonnet 4",
    value: "claude-sonnet-4-20250514",
    provider: "anthropic"
  },
  {
    label: "Claude Sonnet 3.7",
    value: "claude-3-7-sonnet-20250219",
    provider: "anthropic"
  },
  {
    label: "Claude Sonnet 3.5",
    value: "claude-3-5-sonnet-20241022",
    provider: "anthropic"
  },
  {
    label: "Claude Haiku 3.5",
    value: "claude-3-5-haiku-20241022",
    provider: "anthropic"
  },
  {
    label: "Claude Haiku 3",
    value: "claude-3-haiku-20240307",
    provider: "anthropic"
  },
  // Groq (OpenAI-compatible)
  {
    label: "Llama 4 Maverick 17B",
    value: "meta-llama/llama-4-maverick-17b-128e-instruct",
    provider: "groq"
  },
  {
    label: "Llama 4 Scout 17B",
    value: "meta-llama/llama-4-scout-17b-16e-instruct",
    provider: "groq"
  },
  {
    label: "Llama Guard 4 12B",
    value: "meta-llama/llama-guard-4-12b",
    provider: "groq"
  },
  {
    label: "Llama 3.3 70B Versatile",
    value: "llama-3.3-70b-versatile",
    provider: "groq"
  },
  {
    label: "Llama 3.1 8B Instant",
    value: "llama-3.1-8b-instant",
    provider: "groq"
  },
  {
    label: "GPT-OSS 120B",
    value: "openai/gpt-oss-120b",
    provider: "groq"
  },
  {
    label: "GPT-OSS 20B",
    value: "openai/gpt-oss-20b",
    provider: "groq"
  },
  {
    label: "Kimi K2 Instruct 0905",
    value: "moonshotai/kimi-k2-instruct-0905",
    provider: "groq"
  },
  {
    label: "Qwen 3 32B",
    value: "qwen/qwen3-32b",
    provider: "groq"
  },
  // Cerebras (OpenAI-compatible)
  {
    label: "Llama 3.3 70B",
    value: "llama-3.3-70b",
    provider: "cerebras"
  },
  {
    label: "Llama 3.1 8B",
    value: "llama3.1-8b",
    provider: "cerebras"
  },
  {
    label: "GPT-OSS 120B",
    value: "gpt-oss-120b",
    provider: "cerebras"
  },
  {
    label: "Qwen 3 32B",
    value: "qwen-3-32b",
    provider: "cerebras"
  },
  {
    label: "Qwen 3 235B Instruct (Preview)",
    value: "qwen-3-235b-a22b-instruct-2507",
    provider: "cerebras"
  },
  {
    label: "Z.ai GLM 4.7",
    value: "zai-glm-4.7",
    provider: "cerebras"
  }
];
var STREAMING_MODELS_BY_PROVIDER = {
  groq: [
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "moonshotai/kimi-k2-instruct-0905",
    "qwen/qwen3-32b"
  ],
  cerebras: [
    "llama-3.3-70b",
    "llama3.1-8b",
    "gpt-oss-120b",
    "qwen-3-32b",
    "qwen-3-235b-a22b-instruct-2507",
    "zai-glm-4.7"
  ],
  openai: [
    "gpt-5.2",
    "gpt-5.2-chat-latest",
    "gpt-5.1",
    "gpt-5.1-chat-latest",
    "gpt-5",
    "gpt-5-chat-latest",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "o3",
    "o3-mini",
    "o1",
    "o1-mini"
  ],
  gemini: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview"
  ],
  anthropic: [
    "claude-opus-4-1-20250805",
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307"
  ]
};
var MODEL_PROVIDER_MAP = new Map(
  AI_MODELS.map((model) => [model.value, model.provider])
);
function getProviderForModel(model) {
  if (!model) return null;
  const mapped = MODEL_PROVIDER_MAP.get(model);
  if (mapped) return mapped;
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o3") || model.startsWith("o1")) {
    return "openai";
  }
  return null;
}

// src/lib/translation_policy.ts
var PROVIDER_CAPS = {
  openai: { stream: true, jsonStream: true, jsonNonStream: true },
  groq: { stream: true, jsonStream: true, jsonNonStream: true },
  cerebras: { stream: true, jsonStream: false, jsonNonStream: true },
  gemini: { stream: true, jsonStream: true, jsonNonStream: true },
  anthropic: { stream: true, jsonStream: false, jsonNonStream: false }
};
function getProviderCaps(provider) {
  if (!provider) return null;
  return PROVIDER_CAPS[provider] ?? null;
}
function isStreamingModelSupported(provider, model) {
  if (!provider || !model) return true;
  const models = STREAMING_MODELS_BY_PROVIDER[provider] || [];
  return models.includes(model);
}
function getExecutionPlan(params) {
  const { provider, model, streamingDisplay } = params;
  const caps = getProviderCaps(provider);
  if (!caps) {
    return {
      mode: streamingDisplay ? "stream" : "non_stream",
      jsonMode: false,
      reason: "provider_unknown"
    };
  }
  if (!streamingDisplay) {
    return {
      mode: "non_stream",
      jsonMode: caps.jsonNonStream,
      reason: "streaming_disabled"
    };
  }
  if (!caps.stream) {
    return {
      mode: "non_stream",
      jsonMode: caps.jsonNonStream,
      reason: "provider_stream_unsupported"
    };
  }
  if (provider && model) {
    if (!isStreamingModelSupported(provider, model)) {
      return {
        mode: "non_stream",
        jsonMode: caps.jsonNonStream,
        reason: "model_unsupported"
      };
    }
  }
  if (!caps.jsonStream) {
    return {
      mode: "stream",
      jsonMode: false,
      reason: "json_stream_unsupported"
    };
  }
  return {
    mode: "stream",
    jsonMode: caps.jsonStream
  };
}

// src/lib/ai_service.ts
var ENV = define_import_meta_env_default;
function getGeminiClient(apiKey) {
  const key = apiKey || ENV.VITE_GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("Gemini API Key missing");
  return new GoogleGenerativeAI(key);
}
function getOpenAIClient(apiKey) {
  const key = apiKey || ENV.VITE_OPENAI_API_KEY;
  if (!key) throw new Error("OpenAI API Key missing");
  return new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
}
function getAnthropicClient(apiKey) {
  const key = apiKey || ENV.VITE_ANTHROPIC_API_KEY;
  if (!key) throw new Error("Anthropic API Key missing");
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}
var GROQ_BASE_URL = "https://api.groq.com/openai/v1";
var CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
function normalizeJsonText(raw) {
  return raw.replace(/```json/gi, "```").replace(/```/g, "").trim();
}
function extractJsonFromText(raw) {
  const cleaned = normalizeJsonText(raw);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}
function parseJsonFromText(raw) {
  const cleaned = normalizeJsonText(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractJsonFromText(cleaned);
    if (extracted) {
      return JSON.parse(extracted);
    }
    throw new Error("Failed to parse JSON response");
  }
}
function buildProviderHeaders(apiKey, extra = {}) {
  if (!apiKey) throw new Error("API Key missing");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...extra
  };
  if (typeof window === "undefined") {
    headers["User-Agent"] = "Howlingual/1.0";
  }
  return headers;
}
function mapUsageToMetadata(usage) {
  if (!usage || typeof usage !== "object") return void 0;
  const input = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? usage.inputTokenCount;
  const output = usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? usage.outputTokenCount;
  if (typeof input !== "number" && typeof output !== "number") return void 0;
  return {
    input_tokens: typeof input === "number" ? input : 0,
    output_tokens: typeof output === "number" ? output : 0
  };
}
async function fetchChatCompletionJson(params) {
  const res = await fetch(params.url, {
    method: "POST",
    headers: buildProviderHeaders(params.apiKey),
    body: JSON.stringify(params.body),
    signal: params.signal
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status} ${res.statusText}`;
    try {
      const data = JSON.parse(text);
      message = data?.error?.message || data?.message || data?.error || message;
    } catch {
    }
    const err = new Error(message);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}
async function streamChatCompletion(params) {
  const res = await fetch(params.url, {
    method: "POST",
    headers: buildProviderHeaders(params.apiKey, {
      Accept: "text/event-stream"
    }),
    body: JSON.stringify(params.body),
    signal: params.signal
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status} ${res.statusText}`;
    try {
      const data = JSON.parse(text);
      message = data?.error?.message || data?.message || data?.error || message;
    } catch {
    }
    const err = new Error(message);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta?.content || "";
        if (delta) params.onDelta(delta);
        const usage = mapUsageToMetadata(parsed?.usage);
        if (usage && params.onUsage) params.onUsage(usage);
      } catch {
        continue;
      }
    }
  }
}
function extractJsonStringValue(raw, key) {
  const cleaned = normalizeJsonText(raw);
  const keyIndex = cleaned.indexOf(`"${key}"`);
  if (keyIndex === -1) return null;
  const colonIndex = cleaned.indexOf(":", keyIndex);
  if (colonIndex === -1) return null;
  const quoteIndex = cleaned.indexOf('"', colonIndex + 1);
  if (quoteIndex === -1) return null;
  let i = quoteIndex + 1;
  let value = "";
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (ch === "\\") {
      const next = cleaned[i + 1];
      if (next) {
        value += next;
        i += 2;
        continue;
      }
    }
    if (ch === '"') return value;
    value += ch;
    i += 1;
  }
  return value || null;
}
function extractPartialFromJsonLike(raw) {
  const detected = extractJsonStringValue(raw, "detected_source_language");
  const text = extractJsonStringValue(raw, "text");
  const reason = extractJsonStringValue(raw, "reason");
  const partial = {};
  if (detected) partial.detected_source_language = detected;
  if (text || reason) {
    partial.candidates = [
      {
        text: text || "",
        reason: reason || ""
      }
    ];
  }
  return Object.keys(partial).length > 0 ? partial : null;
}
function isReasoningModelName(modelName) {
  return modelName.includes("gpt-oss") || modelName.includes("o1") || modelName.includes("o3") || modelName.includes("qwq") || modelName.includes("deepseek-r1") || modelName.includes("k2-instruct");
}
function getErrorStatus(err) {
  if (!err || typeof err !== "object") return void 0;
  const anyErr = err;
  return anyErr.status ?? anyErr.statusCode ?? anyErr.response?.status ?? anyErr.error?.status ?? void 0;
}
function getErrorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const anyErr = err;
    return anyErr.error?.message || anyErr.message || (anyErr.error ? JSON.stringify(anyErr.error) : "") || String(err);
  }
  return String(err);
}
function shouldRetryWithoutJson(err) {
  const status = getErrorStatus(err);
  if (status !== 400) return false;
  const message = getErrorMessage(err).toLowerCase();
  return message.includes("failed_generation") || message.includes("response_format") || message.includes("json") || message.includes("schema");
}
function buildSystemPrompt(explanationLang = "\u65E5\u672C\u8A9E", candidateCount = 3) {
  return `
\u3042\u306A\u305F\u306F\u30D7\u30ED\u306E\u7FFB\u8A33\u8005\u3067\u3059\u3002
\u30E6\u30FC\u30B6\u30FC\u304B\u3089\u63D0\u4F9B\u3055\u308C\u305F\u539F\u6587\u3092\u3001\u6307\u5B9A\u3055\u308C\u305F\u8A00\u8A9E\u3078\u7FFB\u8A33\u3057\u3066\u304F\u3060\u3055\u3044\u3002

[\u7FFB\u8A33\u306E\u30EB\u30FC\u30EB]
1. **\u53B3\u5BC6\u306B${candidateCount}\u3064\u306E\u7FFB\u8A33\u6848**\u3092\u4F5C\u6210\u3059\u308B\u3053\u3068\u3002
	- 1\u3064\u76EE: \u6587\u8108\u3092\u8003\u616E\u3057\u305F\u3001\u6700\u3082\u6700\u9069\u3067\u81EA\u7136\u306A\u7FFB\u8A33\u3002
	- 2\u3064\u76EE\u4EE5\u964D: \u30CB\u30E5\u30A2\u30F3\u30B9\u3084\u8868\u73FE\u3092\u5909\u3048\u305F\u30D0\u30EA\u30A8\u30FC\u30B7\u30E7\u30F3\u3002
2. **detected_source_language**: \u539F\u6587\u306E\u8A00\u8A9E\u3092\u5224\u5B9A\u3057\u3001${explanationLang}\u3067\u51FA\u529B\u3059\u308B\u3053\u3068\u3002
3. \u5404\u7FFB\u8A33\u6848\u306E\u300Creason\u300D\u3068\u300Cdetailed_explanation\u300D\u306F**${explanationLang}\u3067**\u66F8\u304F\u3053\u3068\u3002
4. **detailed_explanation**: \u91CD\u8981\u306A\u5358\u8A9E\u3084\u6587\u6CD5\u30DD\u30A4\u30F3\u30C8\u30923\u3064\u7A0B\u5EA6\u30D4\u30C3\u30AF\u30A2\u30C3\u30D7\u3057\u3001${explanationLang}\u3067\u8A73\u3057\u304F\u89E3\u8AAC\u3059\u308B\u3053\u3068\u3002
5. \u51FA\u529B\u306F\u5FC5\u305A\u4EE5\u4E0B\u306EJSON\u5F62\u5F0F\u306E\u307F\u3067\u884C\u3046\u3053\u3068\uFF08\u4F59\u8A08\u306A\u8AAC\u660E\u3084\u524D\u7F6E\u304D\u3001Markdown\u3001\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u306F\u7981\u6B62\uFF09\u3002
6. \u30B9\u30C8\u30EA\u30FC\u30E0\u8868\u793A\u306E\u305F\u3081\u3001\u6B21\u306E\u9806\u306B\u51FA\u529B\u3092\u9032\u3081\u308B\u3053\u3068:
   detected_source_language \u2192 candidates[].text \u2192 candidates[].reason \u2192 detailed_explanation\u3002
7. \u6587\u5B57\u5217\u5185\u306E\u5F15\u7528\u7B26\u3084\u6539\u884C\u306F\u3001\u5FC5\u305AJSON\u3068\u3057\u3066\u6B63\u3057\u304F\u30A8\u30B9\u30B1\u30FC\u30D7\u3059\u308B\u3053\u3068\u3002

\`\`\`json
{
  "detected_source_language": "\u30BD\u30FC\u30B9\u8A00\u8A9E",
  "candidates": [
    {
      "text": "\u7FFB\u8A33\u6848",
      "reason": "\u89E3\u8AAC (${explanationLang})"
    }
  ],
  "detailed_explanation": {
    "points": [
      {
        "term": "\u539F\u6587\u306E\u5358\u8A9E\u3084\u30D5\u30EC\u30FC\u30BA",
        "explanation": "\u89E3\u8AAC (${explanationLang})"
      }
    ]
  }
}
\`\`\`
`;
}
var SYSTEM_PROMPT = buildSystemPrompt("\u65E5\u672C\u8A9E", 3);
function buildUserPrompt(text, sourceLang, targetLang, styles, styleMeta = {}) {
  const activeStyles = Object.entries(styles).filter(([_, level]) => level > 0).map(([styleId, level]) => {
    const meta = styleMeta[styleId];
    const label = meta?.name ?? styleId;
    const prompt = meta?.prompt ? ` (${meta.prompt})` : "";
    return `${label}${prompt} (\u5F37\u5EA6: ${level === 2 ? "\u5F37" : "\u5F31"})`;
  }).join(", ");
  return `
	[\u5165\u529B\u60C5\u5831]
	\u539F\u6587: "${text}"
	\u7FFB\u8A33\u5143\u8A00\u8A9E: ${sourceLang === "\u81EA\u52D5\u691C\u51FA" ? "\u81EA\u52D5\u691C\u51FA (Auto-detect)" : sourceLang}
	\u7FFB\u8A33\u5148\u8A00\u8A9E: ${targetLang}
	${activeStyles ? `\u9069\u7528\u3059\u308B\u6587\u4F53\u30FB\u30C8\u30FC\u30F3: ${activeStyles}` : ""}
  `;
}
async function callGemini(modelName, prompt, systemPrompt = SYSTEM_PROMPT, apiKey) {
  const client = getGeminiClient(apiKey);
  const schema = {
    type: SchemaType.OBJECT,
    properties: {
      detected_source_language: { type: SchemaType.STRING, description: "Detected language in Japanese" },
      candidates: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            text: { type: SchemaType.STRING, description: "Translated text" },
            reason: { type: SchemaType.STRING, description: "Explanation in Japanese" }
          },
          required: ["text", "reason"]
        }
      },
      detailed_explanation: {
        type: SchemaType.OBJECT,
        properties: {
          points: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                term: { type: SchemaType.STRING },
                explanation: { type: SchemaType.STRING }
              },
              required: ["term", "explanation"]
            }
          }
        },
        required: ["points"]
      }
    },
    required: ["detected_source_language", "candidates", "detailed_explanation"]
  };
  const model = client.getGenerativeModel({
    model: modelName || "gemini-1.5-flash",
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  });
  const result = await model.generateContent(prompt);
  const parsed = parseJsonFromText(result.response.text());
  if (result.response.usageMetadata) {
    parsed.usage = {
      input_tokens: result.response.usageMetadata.promptTokenCount,
      output_tokens: result.response.usageMetadata.candidatesTokenCount
    };
  }
  return parsed;
}
async function callOpenAI(modelName, prompt, systemPrompt = SYSTEM_PROMPT, apiKey, signal, jsonMode = true) {
  const client = getOpenAIClient(apiKey);
  return callOpenAICompatible(client, modelName, prompt, systemPrompt, {
    signal,
    jsonMode
  });
}
async function callOpenAICompatible(openai, modelName, prompt, systemPrompt, options = {}) {
  const requestParams = {
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ]
  };
  if (options.jsonMode !== false) {
    requestParams.response_format = { type: "json_object" };
  }
  if (isReasoningModelName(modelName)) {
    requestParams.reasoning_effort = "low";
  }
  const completion = await openai.chat.completions.create(requestParams, {
    signal: options.signal
  });
  const content = completion.choices[0].message.content;
  if (!content) throw new Error("No content from OpenAI");
  const parsed = parseJsonFromText(content);
  if (completion.usage) {
    parsed.usage = {
      input_tokens: completion.usage.prompt_tokens,
      output_tokens: completion.usage.completion_tokens
    };
  }
  return parsed;
}
async function callGroqDirect(modelName, prompt, systemPrompt, apiKey, signal, jsonMode = true) {
  const requestParams = {
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ]
  };
  if (jsonMode) {
    requestParams.response_format = { type: "json_object" };
  }
  if (isReasoningModelName(modelName)) {
    requestParams.reasoning_effort = "low";
  }
  const data = await fetchChatCompletionJson({
    url: `${GROQ_BASE_URL}/chat/completions`,
    apiKey,
    body: requestParams,
    signal
  });
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content from Groq");
  const parsed = parseJsonFromText(content);
  const usage = mapUsageToMetadata(data?.usage);
  if (usage) parsed.usage = usage;
  return parsed;
}
async function callCerebrasDirect(modelName, prompt, systemPrompt, apiKey, signal, jsonMode = true) {
  const requestParams = {
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ]
  };
  if (jsonMode) {
    requestParams.response_format = { type: "json_object" };
  }
  if (isReasoningModelName(modelName)) {
    requestParams.reasoning_effort = "low";
  }
  const data = await fetchChatCompletionJson({
    url: `${CEREBRAS_BASE_URL}/chat/completions`,
    apiKey,
    body: requestParams,
    signal
  });
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content from Cerebras");
  const parsed = parseJsonFromText(content);
  const usage = mapUsageToMetadata(data?.usage);
  if (usage) parsed.usage = usage;
  return parsed;
}
async function callAnthropic(modelName, prompt, systemPrompt = SYSTEM_PROMPT, apiKey, signal) {
  const client = getAnthropicClient(apiKey);
  const msg = await client.messages.create(
    {
      model: modelName,
      max_tokens: 1024,
      system: systemPrompt + "\n\nOutput strictly valid JSON.",
      messages: [{ role: "user", content: prompt }]
    },
    { signal }
  );
  const contentBlock = msg.content[0];
  if (contentBlock.type !== "text") throw new Error("Unexpected Anthropic response type");
  const parsed = parseJsonFromText(contentBlock.text);
  if (msg.usage) {
    parsed.usage = {
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens
    };
  }
  return parsed;
}
function tryParsePartialJson(jsonStr) {
  const cleaned = normalizeJsonText(jsonStr);
  const start = cleaned.indexOf("{");
  const trimmed = (start >= 0 ? cleaned.slice(start) : cleaned).replace(
    /,$/,
    ""
  );
  try {
    return JSON.parse(trimmed);
  } catch (e) {
  }
  const closingSequences = [
    // Try closing string and then various nested levels
    '"}]}}',
    // Deepest: inside explanation string
    '"}]}',
    // Inside candidate reason/text string
    '" }',
    // General string close
    "}}",
    // Close objects
    "]}",
    // Close array and object
    "}]}",
    // Close object in array and object
    '"}]}}',
    '"}',
    '"]}',
    '"]}}',
    '"}',
    "]",
    "}"
  ];
  for (const seq of closingSequences) {
    try {
      return JSON.parse(trimmed + seq);
    } catch (e) {
      continue;
    }
  }
  return extractPartialFromJsonLike(trimmed);
}
async function translateTextStream(text, sourceLang, targetLang, styles, model, onUpdate, explanationLang = "\u65E5\u672C\u8A9E", styleMeta = {}, apiKeys = {}, options = {}, candidateCount = 3) {
  const userPrompt = buildUserPrompt(text, sourceLang, targetLang, styles, styleMeta);
  const systemPrompt = buildSystemPrompt(explanationLang, candidateCount);
  const provider = options.provider || getProviderForModel(model);
  const signal = options.signal;
  const plan = getExecutionPlan({
    provider,
    model,
    streamingDisplay: true
  });
  if (plan.mode === "non_stream") {
    if (signal?.aborted) return;
    const response = await translateText(
      text,
      sourceLang,
      targetLang,
      styles,
      model,
      styleMeta,
      candidateCount,
      {
        provider,
        apiKeys,
        explanationLang,
        signal,
        jsonMode: plan.jsonMode
      }
    );
    onUpdate(response, response.usage);
    return;
  }
  if (provider === "gemini" || model.startsWith("gemini")) {
    await streamGemini(
      model,
      userPrompt,
      onUpdate,
      systemPrompt,
      apiKeys.google?.trim() || apiKeys.gemini?.trim(),
      signal
    );
  } else if (provider === "groq") {
    await streamGroq(
      model,
      userPrompt,
      onUpdate,
      systemPrompt,
      apiKeys.groq?.trim(),
      signal,
      plan.jsonMode
    );
  } else if (provider === "cerebras") {
    await streamCerebras(
      model,
      userPrompt,
      onUpdate,
      systemPrompt,
      apiKeys.cerebras?.trim(),
      signal,
      plan.jsonMode
    );
  } else if (provider === "anthropic" || model.startsWith("claude")) {
    await streamAnthropic(model, userPrompt, onUpdate, systemPrompt, apiKeys.anthropic?.trim(), signal);
  } else if (provider === "openai" || model.startsWith("gpt") || model.startsWith("o3")) {
    await streamOpenAI(
      model,
      userPrompt,
      onUpdate,
      systemPrompt,
      apiKeys.openai?.trim(),
      signal,
      plan.jsonMode
    );
  } else {
    throw new Error(`Unsupported model: ${model}`);
  }
}
async function streamGemini(modelName, prompt, onUpdate, systemPrompt, apiKey, signal) {
  const genAI = getGeminiClient(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: "application/json"
    }
  });
  const result = await model.generateContentStream(prompt, { signal });
  let accumulatedText = "";
  let lastPartialKey = "";
  for await (const chunk of result.stream) {
    if (signal?.aborted) return;
    const chunkText = chunk.text();
    accumulatedText += chunkText;
    const partial = tryParsePartialJson(accumulatedText);
    if (partial) {
      const key = JSON.stringify(partial);
      if (key !== lastPartialKey) {
        lastPartialKey = key;
        onUpdate(partial);
      }
    }
  }
  try {
    if (signal?.aborted) return;
    const final = parseJsonFromText(accumulatedText);
    const response = await result.response;
    const usage = response.usageMetadata ? {
      input_tokens: response.usageMetadata.promptTokenCount,
      output_tokens: response.usageMetadata.candidatesTokenCount
    } : void 0;
    if (usage) console.log("[Gemini] Token Usage:", usage);
    onUpdate(final, usage);
  } catch (e) {
    console.warn("Gemini final parse/usage error:", e);
  }
}
async function streamOpenAICompatible(openai, modelName, prompt, onUpdate, systemPrompt, signal, jsonMode = true) {
  const requestParams = {
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    stream: true,
    stream_options: { include_usage: true }
  };
  if (jsonMode) {
    requestParams.response_format = { type: "json_object" };
  }
  if (isReasoningModelName(modelName)) {
    requestParams.reasoning_effort = "low";
  }
  const stream = await openai.chat.completions.create(requestParams, { signal });
  let accumulatedText = "";
  let lastPartialKey = "";
  for await (const chunk of stream) {
    if (signal?.aborted) return;
    const content = chunk.choices[0]?.delta?.content || "";
    if (chunk.usage) {
      const partialForUsage = tryParsePartialJson(accumulatedText) || {};
      onUpdate(partialForUsage, {
        input_tokens: chunk.usage.prompt_tokens,
        output_tokens: chunk.usage.completion_tokens
      });
      console.log("[OpenAI] Token Usage:", chunk.usage);
    }
    if (content) {
      accumulatedText += content;
      const partial = tryParsePartialJson(accumulatedText);
      if (partial) {
        const key = JSON.stringify(partial);
        if (key !== lastPartialKey) {
          lastPartialKey = key;
          onUpdate(partial);
        }
      }
    }
  }
  try {
    if (accumulatedText.trim()) {
      const final = parseJsonFromText(accumulatedText);
      console.log("[OpenAI] Final Full JSON parsed successfully.");
      onUpdate(final);
    }
  } catch (e) {
    console.warn("[OpenAI] Final JSON parse failed:", e);
  }
}
async function streamProviderChatCompletion(params) {
  const requestParams = {
    model: params.modelName,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.prompt }
    ],
    stream: true
  };
  if (params.jsonMode) {
    requestParams.response_format = { type: "json_object" };
  }
  if (isReasoningModelName(params.modelName)) {
    requestParams.reasoning_effort = "low";
  }
  let accumulatedText = "";
  let lastPartialKey = "";
  await streamChatCompletion({
    url: params.url,
    apiKey: params.apiKey,
    body: requestParams,
    signal: params.signal,
    onDelta: (delta) => {
      accumulatedText += delta;
      const partial = tryParsePartialJson(accumulatedText);
      if (partial) {
        const key = JSON.stringify(partial);
        if (key !== lastPartialKey) {
          lastPartialKey = key;
          params.onUpdate(partial);
        }
      }
    },
    onUsage: (usage) => {
      const partialForUsage = tryParsePartialJson(accumulatedText) || {};
      params.onUpdate(partialForUsage, usage);
    }
  });
  try {
    if (accumulatedText.trim()) {
      const final = parseJsonFromText(accumulatedText);
      params.onUpdate(final);
    }
  } catch (e) {
    console.warn("[Stream] Final JSON parse failed:", e);
  }
}
async function streamOpenAI(modelName, prompt, onUpdate, systemPrompt, apiKey, signal, jsonMode = true) {
  const openai = getOpenAIClient(apiKey);
  await streamOpenAICompatible(
    openai,
    modelName,
    prompt,
    onUpdate,
    systemPrompt,
    signal,
    jsonMode
  );
}
async function streamGroq(modelName, prompt, onUpdate, systemPrompt, apiKey, signal, jsonMode = true) {
  await streamProviderChatCompletion({
    url: `${GROQ_BASE_URL}/chat/completions`,
    apiKey,
    modelName,
    prompt,
    onUpdate,
    systemPrompt,
    signal,
    jsonMode
  });
}
async function streamCerebras(modelName, prompt, onUpdate, systemPrompt, apiKey, signal, jsonMode = true) {
  await streamProviderChatCompletion({
    url: `${CEREBRAS_BASE_URL}/chat/completions`,
    apiKey,
    modelName,
    prompt,
    onUpdate,
    systemPrompt,
    signal,
    jsonMode
  });
}
async function streamAnthropic(modelName, prompt, onUpdate, systemPrompt, apiKey, signal) {
  const anthropic = getAnthropicClient(apiKey);
  const stream = await anthropic.messages.create(
    {
      model: modelName,
      max_tokens: 1024,
      system: systemPrompt + "\n\nOutput strictly valid JSON.",
      messages: [{ role: "user", content: prompt }],
      stream: true
    },
    { signal }
  );
  let accumulatedText = "";
  let lastPartialKey = "";
  let currentUsage = { input_tokens: 0, output_tokens: 0 };
  for await (const chunk of stream) {
    if (signal?.aborted) return;
    if (chunk.type === "message_start") {
      currentUsage.input_tokens = chunk.message.usage.input_tokens;
      currentUsage.output_tokens = chunk.message.usage.output_tokens;
      onUpdate({}, currentUsage);
    } else if (chunk.type === "message_delta") {
      if (chunk.usage) {
        currentUsage.output_tokens = chunk.usage.output_tokens;
        onUpdate({}, currentUsage);
        console.log("[Anthropic] Updated Usage:", currentUsage);
      }
    } else if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      accumulatedText += chunk.delta.text;
      const jsonStart = accumulatedText.indexOf("{");
      if (jsonStart !== -1) {
        const jsonPart = accumulatedText.substring(jsonStart);
        const partial = tryParsePartialJson(jsonPart);
        if (partial) {
          const key = JSON.stringify(partial);
          if (key !== lastPartialKey) {
            lastPartialKey = key;
            onUpdate(partial, currentUsage);
          }
        }
      }
    }
  }
  if (!signal?.aborted && accumulatedText.trim()) {
    try {
      const final = parseJsonFromText(accumulatedText);
      onUpdate(final, currentUsage);
    } catch (e) {
      console.warn("[Anthropic] Final JSON parse failed:", e);
    }
  }
}
async function translateText(text, sourceLang, targetLang, styles, model = "gemini-1.5-flash", styleMeta = {}, candidateCount = 3, options = {}) {
  const userPrompt = buildUserPrompt(text, sourceLang, targetLang, styles, styleMeta);
  const systemPrompt = buildSystemPrompt(
    options.explanationLang || "\u65E5\u672C\u8A9E",
    candidateCount
  );
  const provider = options.provider || getProviderForModel(model);
  const jsonMode = options.jsonMode !== false;
  let response;
  if (provider === "gemini" || model.startsWith("gemini")) {
    response = await callGemini(
      model,
      userPrompt,
      systemPrompt,
      options.apiKeys?.google?.trim() || options.apiKeys?.gemini?.trim()
    );
  } else if (provider === "openai" || model.startsWith("gpt") || model.startsWith("o3")) {
    response = await callOpenAI(
      model,
      userPrompt,
      systemPrompt,
      options.apiKeys?.openai?.trim(),
      options.signal,
      jsonMode
    );
  } else if (provider === "groq") {
    response = await callGroqDirect(
      model,
      userPrompt,
      systemPrompt,
      options.apiKeys?.groq?.trim(),
      options.signal,
      jsonMode
    );
  } else if (provider === "cerebras") {
    try {
      response = await callCerebrasDirect(
        model,
        userPrompt,
        systemPrompt,
        options.apiKeys?.cerebras?.trim(),
        options.signal,
        jsonMode
      );
    } catch (err) {
      if (jsonMode && shouldRetryWithoutJson(err)) {
        response = await callCerebrasDirect(
          model,
          userPrompt,
          systemPrompt,
          options.apiKeys?.cerebras?.trim(),
          options.signal,
          false
        );
      } else {
        throw err;
      }
    }
  } else if (provider === "anthropic" || model.startsWith("claude")) {
    response = await callAnthropic(
      model,
      userPrompt,
      systemPrompt,
      options.apiKeys?.anthropic?.trim(),
      options.signal
    );
  } else {
    throw new Error(`Unsupported model: ${model}`);
  }
  response.candidates = response.candidates.map((c, i) => ({ ...c, id: i + 1 }));
  return response;
}
export {
  translateText,
  translateTextStream
};
