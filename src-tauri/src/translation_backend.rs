use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use keyring::Entry;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

const TRANSLATION_EVENT: &str = "translation_update";
const KEYRING_SERVICE: &str = "com.howlingual.keys";

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub id: Option<u32>,
    pub text: String,
    pub reason: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ExplanationPoint {
    pub term: String,
    pub explanation: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct DetailedExplanation {
    pub points: Vec<ExplanationPoint>,
}

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct UsageMetadata {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TranslationPhase {
    #[default]
    Idle,
    Submitting,
    WaitingModel,
    Streaming,
    Stopped,
    Error,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TechMetrics {
    pub time: f64,
    pub wait_time: f64,
    pub gen_time: f64,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub tokens_per_sec: f64,
    pub stream_mode: bool,
    pub is_real: bool,
    pub first_token_received: bool,
}

#[derive(Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    Stream,
    #[default]
    NonStream,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionReason {
    StreamingDisabled,
    ProviderStreamUnsupported,
    ModelUnsupported,
    ProviderUnknown,
    JsonStreamUnsupported,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlanPayload {
    pub provider: String,
    pub model: String,
    pub requested_mode: ExecutionMode,
    pub planned_mode: ExecutionMode,
    pub actual_mode: ExecutionMode,
    pub json_mode: bool,
    pub stream_attempted: bool,
    pub fallback_to_non_stream: bool,
    pub can_stream: bool,
    pub can_json_stream: bool,
    pub can_json_non_stream: bool,
    pub model_stream_supported: bool,
    pub reason: Option<ExecutionReason>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationStatePayload {
    pub run_id: u64,
    pub updated_at: u64,
    pub phase: TranslationPhase,
    pub input_query: String,
    pub source_lang: String,
    pub detected_lang: String,
    pub is_detecting: bool,
    pub target_lang: String,
    pub style_levels: HashMap<String, i32>,
    pub translations: Vec<TranslationResult>,
    pub detailed_explanation: Option<DetailedExplanation>,
    pub tech_metrics: TechMetrics,
    pub error_message: String,
    pub is_translating: bool,
    pub current_model: String,
    pub candidate_count: u8,
    pub execution_plan: ExecutionPlanPayload,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleMeta {
    pub name: String,
    pub prompt: Option<String>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTranslationContextPayload {
    pub input_query: Option<String>,
    pub source_lang: Option<String>,
    pub detected_lang: Option<String>,
    pub is_detecting: Option<bool>,
    pub target_lang: Option<String>,
    pub style_levels: Option<HashMap<String, i32>>,
    pub candidate_count: Option<u8>,
    pub reset_translations: Option<bool>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTranslationPayload {
    pub text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub styles: HashMap<String, i32>,
    pub style_meta: HashMap<String, StyleMeta>,
    pub model: String,
    pub provider: String,
    pub api_key: Option<String>,
    pub explanation_lang: Option<String>,
    pub initial_tokens: Option<u64>,
    pub candidate_count: Option<u8>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyPayload {
    pub provider: String,
    pub value: String,
    pub persist: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPayload {
    pub provider: String,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiKeyPresence {
    #[default]
    Unset,
    Session,
    Stored,
}

#[derive(Clone, Default, Serialize)]
pub struct ApiKeyStatus {
    pub openai: ApiKeyPresence,
    pub gemini: ApiKeyPresence,
    pub anthropic: ApiKeyPresence,
    pub groq: ApiKeyPresence,
    pub cerebras: ApiKeyPresence,
}

#[derive(Default)]
struct TranslationBackendInner {
    state: TranslationStatePayload,
    session_api_keys: HashMap<String, String>,
}

pub struct TranslationBackendState(Mutex<TranslationBackendInner>);

impl Default for TranslationBackendState {
    fn default() -> Self {
        let mut inner = TranslationBackendInner::default();
        inner.state.candidate_count = 3;
        Self(Mutex::new(inner))
    }
}

#[derive(Clone, Default)]
struct ProviderResponse {
    detected_source_language: String,
    candidates: Vec<TranslationResult>,
    detailed_explanation: Option<DetailedExplanation>,
    usage: Option<UsageMetadata>,
}

#[derive(Default)]
struct PartialProviderResponse {
    detected_source_language: Option<String>,
    candidates: Vec<TranslationResult>,
}

#[derive(Clone, Copy)]
struct ProviderCaps {
    stream: bool,
    json_stream: bool,
    json_non_stream: bool,
}

const OPENAI_STREAMING_MODELS: &[&str] = &[
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.3-chat-latest",
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
    "o4-mini",
    "o3",
    "o3-mini",
    "o1",
];

const OPENAI_RESPONSES_ONLY_MODELS: &[&str] = &["gpt-5.4-pro"];

const GEMINI_STREAMING_MODELS: &[&str] = &[
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
];

const ANTHROPIC_STREAMING_MODELS: &[&str] = &[
    "claude-opus-4-1-20250805",
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
];

const GROQ_STREAMING_MODELS: &[&str] = &[
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "moonshotai/kimi-k2-instruct-0905",
    "qwen/qwen3-32b",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
];

const CEREBRAS_STREAMING_MODELS: &[&str] = &[
    "llama3.1-8b",
    "gpt-oss-120b",
    "qwen-3-235b-a22b-instruct-2507",
    "zai-glm-4.7",
];

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

fn emit_state(app: &AppHandle, payload: &TranslationStatePayload) {
    let _ = app.emit(TRANSLATION_EVENT, payload.clone());
}

fn update_phase(state: &mut TranslationStatePayload, phase: TranslationPhase) {
    if state.phase != phase {
        state.phase = phase;
    }
}

fn with_backend_state<T, F>(state: &State<'_, TranslationBackendState>, f: F) -> Result<T, String>
where
    F: FnOnce(&mut TranslationBackendInner) -> T,
{
    let mut inner = state
        .0
        .lock()
        .map_err(|_| "Translation state lock failed".to_string())?;
    Ok(f(&mut inner))
}

fn set_updated(payload: &mut TranslationStatePayload) {
    payload.updated_at = now_ms();
}

fn build_empty_translations(count: u8) -> Vec<TranslationResult> {
    let safe_count = count.clamp(1, 6);
    (0..safe_count)
        .map(|idx| TranslationResult {
            id: Some((idx + 1) as u32),
            text: String::new(),
            reason: String::new(),
        })
        .collect()
}

fn get_provider_caps(provider: &str) -> Option<ProviderCaps> {
    match provider {
        "openai" => Some(ProviderCaps {
            stream: true,
            json_stream: true,
            json_non_stream: true,
        }),
        "groq" => Some(ProviderCaps {
            stream: true,
            json_stream: true,
            json_non_stream: true,
        }),
        "cerebras" => Some(ProviderCaps {
            stream: true,
            json_stream: false,
            json_non_stream: true,
        }),
        "gemini" => Some(ProviderCaps {
            stream: true,
            json_stream: true,
            json_non_stream: true,
        }),
        "anthropic" => Some(ProviderCaps {
            stream: true,
            json_stream: false,
            json_non_stream: false,
        }),
        _ => None,
    }
}

fn is_streaming_model_supported(provider: &str, model: &str) -> bool {
    let supported_models = match provider {
        "openai" => OPENAI_STREAMING_MODELS,
        "gemini" => GEMINI_STREAMING_MODELS,
        "anthropic" => ANTHROPIC_STREAMING_MODELS,
        "groq" => GROQ_STREAMING_MODELS,
        "cerebras" => CEREBRAS_STREAMING_MODELS,
        _ => return false,
    };

    supported_models.contains(&model)
}

fn is_openai_responses_only_model(model: &str) -> bool {
    OPENAI_RESPONSES_ONLY_MODELS.contains(&model)
}

fn build_execution_plan(provider: &str, model: &str) -> ExecutionPlanPayload {
    let requested_mode = ExecutionMode::Stream;
    let caps = get_provider_caps(provider);
    let model_stream_supported = match caps {
        Some(_) if model.is_empty() => true,
        Some(_) => is_streaming_model_supported(provider, model),
        None => false,
    };

    match caps {
        None => ExecutionPlanPayload {
            provider: provider.to_string(),
            model: model.to_string(),
            requested_mode,
            planned_mode: ExecutionMode::Stream,
            actual_mode: ExecutionMode::Stream,
            json_mode: false,
            stream_attempted: false,
            fallback_to_non_stream: false,
            can_stream: false,
            can_json_stream: false,
            can_json_non_stream: false,
            model_stream_supported: false,
            reason: Some(ExecutionReason::ProviderUnknown),
        },
        Some(caps) if !caps.stream => ExecutionPlanPayload {
            provider: provider.to_string(),
            model: model.to_string(),
            requested_mode,
            planned_mode: ExecutionMode::NonStream,
            actual_mode: ExecutionMode::NonStream,
            json_mode: caps.json_non_stream,
            stream_attempted: false,
            fallback_to_non_stream: false,
            can_stream: false,
            can_json_stream: caps.json_stream,
            can_json_non_stream: caps.json_non_stream,
            model_stream_supported,
            reason: Some(ExecutionReason::ProviderStreamUnsupported),
        },
        Some(caps) if !model_stream_supported => ExecutionPlanPayload {
            provider: provider.to_string(),
            model: model.to_string(),
            requested_mode,
            planned_mode: ExecutionMode::NonStream,
            actual_mode: ExecutionMode::NonStream,
            json_mode: caps.json_non_stream,
            stream_attempted: false,
            fallback_to_non_stream: false,
            can_stream: true,
            can_json_stream: caps.json_stream,
            can_json_non_stream: caps.json_non_stream,
            model_stream_supported: false,
            reason: Some(ExecutionReason::ModelUnsupported),
        },
        Some(caps) if !caps.json_stream => ExecutionPlanPayload {
            provider: provider.to_string(),
            model: model.to_string(),
            requested_mode,
            planned_mode: ExecutionMode::Stream,
            actual_mode: ExecutionMode::Stream,
            json_mode: false,
            stream_attempted: false,
            fallback_to_non_stream: false,
            can_stream: true,
            can_json_stream: false,
            can_json_non_stream: caps.json_non_stream,
            model_stream_supported,
            reason: Some(ExecutionReason::JsonStreamUnsupported),
        },
        Some(caps) => ExecutionPlanPayload {
            provider: provider.to_string(),
            model: model.to_string(),
            requested_mode,
            planned_mode: ExecutionMode::Stream,
            actual_mode: ExecutionMode::Stream,
            json_mode: true,
            stream_attempted: false,
            fallback_to_non_stream: false,
            can_stream: true,
            can_json_stream: caps.json_stream,
            can_json_non_stream: caps.json_non_stream,
            model_stream_supported,
            reason: None,
        },
    }
}

fn build_system_prompt(explanation_lang: &str, candidate_count: u8) -> String {
    format!(
        r#"
あなたはプロの翻訳者です。
ユーザーから提供された原文を、指定された言語へ翻訳してください。

[翻訳のルール]
1. 厳密に{candidate_count}つの翻訳案を作成すること。
2. detected_source_language は {explanation_lang} で出力すること。
3. 各翻訳案の reason と detailed_explanation は {explanation_lang} で書くこと。
4. detailed_explanation では重要な単語や文法ポイントを3つ程度ピックアップして解説すること。
5. 出力は JSON のみ。前置き・Markdown・コードフェンスは禁止。
6. 文字列内の引用符や改行は JSON として正しくエスケープすること。

{{
  "detected_source_language": "ソース言語",
  "candidates": [
    {{
      "text": "翻訳案",
      "reason": "解説"
    }}
  ],
  "detailed_explanation": {{
    "points": [
      {{
        "term": "原文の語句",
        "explanation": "解説"
      }}
    ]
  }}
}}
"#
    )
}

fn build_user_prompt(
    text: &str,
    source_lang: &str,
    target_lang: &str,
    styles: &HashMap<String, i32>,
    style_meta: &HashMap<String, StyleMeta>,
) -> String {
    let active_styles = styles
        .iter()
        .filter(|(_, level)| **level > 0)
        .map(|(style_id, level)| {
            let meta = style_meta.get(style_id);
            let label = meta.map(|m| m.name.as_str()).unwrap_or(style_id.as_str());
            let prompt = meta
                .and_then(|m| m.prompt.as_ref())
                .map(|p| format!(" ({p})"))
                .unwrap_or_default();
            let intensity = if *level >= 2 { "強" } else { "弱" };
            format!("{label}{prompt} (強度: {intensity})")
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        r#"
[入力情報]
原文: "{text}"
翻訳元言語: {}
翻訳先言語: {target_lang}
{}
"#,
        if source_lang == "自動検出" {
            "自動検出 (Auto-detect)"
        } else {
            source_lang
        },
        if active_styles.is_empty() {
            String::new()
        } else {
            format!("適用する文体・トーン: {active_styles}")
        }
    )
}

fn extract_json(raw: &str) -> Result<Value, String> {
    let cleaned = raw
        .replace("```json", "```")
        .replace("```", "")
        .trim()
        .to_string();
    match serde_json::from_str::<Value>(&cleaned) {
        Ok(value) => Ok(value),
        Err(_) => {
            let start = cleaned
                .find('{')
                .ok_or_else(|| "JSON start not found".to_string())?;
            let end = cleaned
                .rfind('}')
                .ok_or_else(|| "JSON end not found".to_string())?;
            let sliced = &cleaned[start..=end];
            serde_json::from_str::<Value>(sliced).map_err(|e| e.to_string())
        }
    }
}

fn usage_from_value(value: &Value) -> Option<UsageMetadata> {
    let input = value
        .get("prompt_tokens")
        .or_else(|| value.get("input_tokens"))
        .or_else(|| value.get("promptTokenCount"))
        .or_else(|| value.get("inputTokenCount"))
        .and_then(Value::as_u64);
    let output = value
        .get("completion_tokens")
        .or_else(|| value.get("output_tokens"))
        .or_else(|| value.get("candidatesTokenCount"))
        .or_else(|| value.get("outputTokenCount"))
        .and_then(Value::as_u64);

    match (input, output) {
        (None, None) => None,
        _ => Some(UsageMetadata {
            input_tokens: input.unwrap_or_default(),
            output_tokens: output.unwrap_or_default(),
        }),
    }
}

fn response_output_text(value: &Value) -> Option<String> {
    let mut parts = Vec::new();

    for item in value
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if item.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        for content in item
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if content.get("type").and_then(Value::as_str) == Some("output_text") {
                if let Some(text) = content.get("text").and_then(Value::as_str) {
                    parts.push(text);
                }
            }
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(""))
    }
}

fn response_from_json(
    value: Value,
    usage: Option<UsageMetadata>,
) -> Result<ProviderResponse, String> {
    let detected_source_language = value
        .get("detected_source_language")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let candidates = value
        .get("candidates")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(idx, item)| TranslationResult {
                    id: Some((idx + 1) as u32),
                    text: item
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    reason: item
                        .get("reason")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if candidates.is_empty() {
        return Err("Provider returned no candidates".into());
    }

    let detailed_explanation = value
        .get("detailed_explanation")
        .and_then(|v| serde_json::from_value::<DetailedExplanation>(v.clone()).ok());

    Ok(ProviderResponse {
        detected_source_language,
        candidates,
        detailed_explanation,
        usage,
    })
}

fn decode_json_string_lossy(raw: &str) -> String {
    let mut output = String::new();
    let mut chars = raw.chars();

    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }

        match chars.next() {
            Some('"') => output.push('"'),
            Some('\\') => output.push('\\'),
            Some('/') => output.push('/'),
            Some('b') => output.push('\u{0008}'),
            Some('f') => output.push('\u{000c}'),
            Some('n') => output.push('\n'),
            Some('r') => output.push('\r'),
            Some('t') => output.push('\t'),
            Some('u') => {
                let mut hex = String::new();
                for _ in 0..4 {
                    let Some(next) = chars.next() else {
                        return output;
                    };
                    hex.push(next);
                }
                if let Ok(code) = u16::from_str_radix(&hex, 16) {
                    if let Some(decoded) = char::from_u32(code as u32) {
                        output.push(decoded);
                    }
                }
            }
            Some(other) => output.push(other),
            None => break,
        }
    }

    output
}

fn find_json_string_value(buffer: &str, key: &str, start_at: usize) -> Option<(String, usize)> {
    let key_pattern = format!("\"{key}\"");
    let key_offset = buffer.get(start_at..)?.find(&key_pattern)? + start_at;
    let bytes = buffer.as_bytes();
    let mut cursor = key_offset + key_pattern.len();

    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    if cursor >= bytes.len() || bytes[cursor] != b':' {
        return None;
    }
    cursor += 1;

    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    if cursor >= bytes.len() || bytes[cursor] != b'"' {
        return None;
    }
    cursor += 1;

    let value_start = cursor;
    let mut escaped = false;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if escaped {
            escaped = false;
            cursor += 1;
            continue;
        }
        if byte == b'\\' {
            escaped = true;
            cursor += 1;
            continue;
        }
        if byte == b'"' {
            return Some((
                decode_json_string_lossy(&buffer[value_start..cursor]),
                cursor + 1,
            ));
        }
        cursor += 1;
    }

    Some((
        decode_json_string_lossy(&buffer[value_start..]),
        bytes.len(),
    ))
}

fn extract_partial_response(buffer: &str, candidate_count: u8) -> PartialProviderResponse {
    let mut partial = PartialProviderResponse::default();

    if let Some((detected, _)) = find_json_string_value(buffer, "detected_source_language", 0) {
        if !detected.is_empty() {
            partial.detected_source_language = Some(detected);
        }
    }

    let mut cursor = 0;
    while partial.candidates.len() < candidate_count as usize {
        let Some((text, next_cursor)) = find_json_string_value(buffer, "text", cursor) else {
            break;
        };
        let (reason, reason_cursor) =
            find_json_string_value(buffer, "reason", next_cursor).unwrap_or_default();
        partial.candidates.push(TranslationResult {
            id: Some((partial.candidates.len() + 1) as u32),
            text,
            reason,
        });
        cursor = reason_cursor.max(next_cursor);
    }

    partial
}

#[derive(Default)]
struct SseEvent {
    event: String,
    data: String,
}

fn next_sse_separator(buffer: &[u8]) -> Option<(usize, usize)> {
    for (idx, window) in buffer.windows(4).enumerate() {
        if window == b"\r\n\r\n" {
            return Some((idx, 4));
        }
    }
    for (idx, window) in buffer.windows(2).enumerate() {
        if window == b"\n\n" {
            return Some((idx, 2));
        }
    }
    None
}

fn drain_sse_events(buffer: &mut Vec<u8>) -> Vec<SseEvent> {
    let mut events = Vec::new();

    while let Some((split_at, separator_len)) = next_sse_separator(buffer) {
        let chunk = buffer.drain(..split_at + separator_len).collect::<Vec<_>>();
        let body = &chunk[..chunk.len().saturating_sub(separator_len)];
        let text = String::from_utf8_lossy(body);
        let mut event = SseEvent::default();

        for line in text.lines() {
            let trimmed = line.trim_end_matches('\r');
            if let Some(value) = trimmed.strip_prefix("event:") {
                event.event = value.trim().to_string();
            } else if let Some(value) = trimmed.strip_prefix("data:") {
                if !event.data.is_empty() {
                    event.data.push('\n');
                }
                event.data.push_str(value.trim_start());
            }
        }

        if !event.data.is_empty() || !event.event.is_empty() {
            events.push(event);
        }
    }

    events
}

fn bearer_headers(api_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(|e| e.to_string())?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(headers)
}

fn is_reasoning_model(model: &str) -> bool {
    model.contains("gpt-oss")
        || model.contains("o1")
        || model.contains("o3")
        || model.contains("qwq")
        || model.contains("deepseek-r1")
        || model.contains("k2-instruct")
}

async fn call_openai_like(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ProviderResponse, String> {
    let mut body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "response_format": { "type": "json_object" }
    });
    if is_reasoning_model(model) {
        body["reasoning_effort"] = Value::String("low".into());
    }

    let response = client
        .post(url)
        .headers(bearer_headers(api_key)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    let data = serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())?;
    let content = data
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| "OpenAI-compatible response content missing".to_string())?;
    response_from_json(
        extract_json(content)?,
        data.get("usage").and_then(usage_from_value),
    )
}

async fn call_openai_responses(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ProviderResponse, String> {
    let body = json!({
        "model": model,
        "instructions": system_prompt,
        "input": user_prompt,
        "text": {
            "format": {
                "type": "json_object"
            }
        },
        "reasoning": {
            "effort": "medium"
        }
    });

    let response = client
        .post("https://api.openai.com/v1/responses")
        .headers(bearer_headers(api_key)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    let data = serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())?;
    let content = response_output_text(&data)
        .ok_or_else(|| "OpenAI Responses output text missing".to_string())?;

    response_from_json(
        extract_json(&content)?,
        data.get("usage").and_then(usage_from_value),
    )
}

async fn call_anthropic(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ProviderResponse, String> {
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": 1024,
            "system": format!("{system_prompt}\n\nOutput strictly valid JSON."),
            "messages": [{ "role": "user", "content": user_prompt }]
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }
    let data = serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())?;
    let content = data
        .pointer("/content/0/text")
        .and_then(Value::as_str)
        .ok_or_else(|| "Anthropic response text missing".to_string())?;
    response_from_json(
        extract_json(content)?,
        data.get("usage").and_then(usage_from_value),
    )
}

async fn call_gemini(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ProviderResponse, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    );
    let response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
            "system_instruction": {
                "parts": [{ "text": system_prompt }]
            },
            "contents": [{
                "role": "user",
                "parts": [{ "text": user_prompt }]
            }],
            "generationConfig": {
                "responseMimeType": "application/json"
            }
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }
    let data = serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())?;
    let content = data
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .ok_or_else(|| "Gemini response text missing".to_string())?;
    response_from_json(
        extract_json(content)?,
        data.get("usageMetadata").and_then(usage_from_value),
    )
}

fn apply_partial_stream_update(
    app: &AppHandle,
    state: &TranslationBackendState,
    run_id: u64,
    started_at: u64,
    content_buffer: &str,
    usage: Option<UsageMetadata>,
) -> bool {
    let mut should_continue = true;

    if let Ok(mut inner) = state.0.lock() {
        if inner.state.run_id != run_id {
            return false;
        }

        let partial = extract_partial_response(content_buffer, inner.state.candidate_count);
        let elapsed = (now_ms().saturating_sub(started_at) as f64) / 1000.0;
        let mut changed = false;

        if !inner.state.tech_metrics.first_token_received {
            inner.state.tech_metrics.first_token_received = true;
            inner.state.tech_metrics.wait_time = elapsed;
            inner.state.tech_metrics.gen_time = 0.0;
            changed = true;
        }

        update_phase(&mut inner.state, TranslationPhase::Streaming);
        inner.state.tech_metrics.time = elapsed;
        inner.state.tech_metrics.gen_time = (elapsed - inner.state.tech_metrics.wait_time).max(0.0);
        inner.state.tech_metrics.stream_mode = true;

        if let Some(real_usage) = usage {
            inner.state.tech_metrics.input_tokens = real_usage.input_tokens;
            inner.state.tech_metrics.output_tokens = real_usage.output_tokens;
            inner.state.tech_metrics.is_real = true;
        }

        if let Some(detected) = partial.detected_source_language {
            if detected != inner.state.detected_lang {
                inner.state.detected_lang = detected;
                changed = true;
            }
        }

        let expected_len = inner.state.candidate_count as usize;
        if inner.state.translations.len() != expected_len {
            inner.state.translations = build_empty_translations(inner.state.candidate_count);
            changed = true;
        }

        for (idx, candidate) in partial.candidates.iter().enumerate() {
            if let Some(slot) = inner.state.translations.get_mut(idx) {
                if slot.text != candidate.text {
                    slot.text = candidate.text.clone();
                    changed = true;
                }
                if slot.reason != candidate.reason {
                    slot.reason = candidate.reason.clone();
                    changed = true;
                }
            }
        }

        if inner.state.tech_metrics.gen_time > 0.0 && inner.state.tech_metrics.output_tokens > 0 {
            inner.state.tech_metrics.tokens_per_sec =
                inner.state.tech_metrics.output_tokens as f64 / inner.state.tech_metrics.gen_time;
        }

        if changed {
            set_updated(&mut inner.state);
            emit_state(app, &inner.state);
        }
    } else {
        should_continue = false;
    }

    should_continue
}

async fn stream_openai_like<F>(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    mut on_chunk: F,
) -> Result<(String, Option<UsageMetadata>), String>
where
    F: FnMut(&str, Option<UsageMetadata>) -> bool,
{
    let mut body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "response_format": { "type": "json_object" },
        "stream": true
    });
    if url.contains("api.openai.com") {
        body["stream_options"] = json!({ "include_usage": true });
    }
    if is_reasoning_model(model) {
        body["reasoning_effort"] = Value::String("low".into());
    }

    let response = client
        .post(url)
        .headers(bearer_headers(api_key)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.map_err(|e| e.to_string())?;
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    let mut stream = response.bytes_stream();
    let mut sse_buffer = Vec::new();
    let mut content = String::new();
    let mut usage = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        sse_buffer.extend_from_slice(&chunk);

        for event in drain_sse_events(&mut sse_buffer) {
            if event.data == "[DONE]" {
                continue;
            }
            let data = serde_json::from_str::<Value>(&event.data).map_err(|e| e.to_string())?;
            if let Some(delta) = data
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
            {
                content.push_str(delta);
                if !on_chunk(&content, usage) {
                    return Ok((content, usage));
                }
            }

            if usage.is_none() {
                usage = data.get("usage").and_then(usage_from_value);
            }
        }
    }

    Ok((content, usage))
}

async fn stream_anthropic<F>(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    mut on_chunk: F,
) -> Result<(String, Option<UsageMetadata>), String>
where
    F: FnMut(&str, Option<UsageMetadata>) -> bool,
{
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": 1024,
            "stream": true,
            "system": format!("{system_prompt}\n\nOutput strictly valid JSON."),
            "messages": [{ "role": "user", "content": user_prompt }]
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.map_err(|e| e.to_string())?;
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    let mut stream = response.bytes_stream();
    let mut sse_buffer = Vec::new();
    let mut content = String::new();
    let mut usage = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        sse_buffer.extend_from_slice(&chunk);

        for event in drain_sse_events(&mut sse_buffer) {
            if event.data.is_empty() {
                continue;
            }
            let data = serde_json::from_str::<Value>(&event.data).map_err(|e| e.to_string())?;

            if let Some(text_delta) = data.pointer("/delta/text").and_then(Value::as_str) {
                content.push_str(text_delta);
                if !on_chunk(&content, usage) {
                    return Ok((content, usage));
                }
            }

            if usage.is_none() {
                usage = data.get("usage").and_then(usage_from_value);
            }
        }
    }

    Ok((content, usage))
}

async fn stream_gemini<F>(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    mut on_chunk: F,
) -> Result<(String, Option<UsageMetadata>), String>
where
    F: FnMut(&str, Option<UsageMetadata>) -> bool,
{
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={api_key}"
    );
    let response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
            "system_instruction": {
                "parts": [{ "text": system_prompt }]
            },
            "contents": [{
                "role": "user",
                "parts": [{ "text": user_prompt }]
            }],
            "generationConfig": {
                "responseMimeType": "application/json"
            }
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.map_err(|e| e.to_string())?;
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    let mut stream = response.bytes_stream();
    let mut sse_buffer = Vec::new();
    let mut content = String::new();
    let mut usage = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        sse_buffer.extend_from_slice(&chunk);

        for event in drain_sse_events(&mut sse_buffer) {
            if event.data.is_empty() {
                continue;
            }
            let data = serde_json::from_str::<Value>(&event.data).map_err(|e| e.to_string())?;
            if let Some(part) = data
                .pointer("/candidates/0/content/parts/0/text")
                .and_then(Value::as_str)
            {
                if part.starts_with(&content) {
                    content = part.to_string();
                } else {
                    content.push_str(part);
                }
                if !on_chunk(&content, usage) {
                    return Ok((content, usage));
                }
            }

            if usage.is_none() {
                usage = data.get("usageMetadata").and_then(usage_from_value);
            }
        }
    }

    Ok((content, usage))
}

async fn translate_with_provider_streaming<F>(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    on_chunk: F,
) -> Result<ProviderResponse, String>
where
    F: FnMut(&str, Option<UsageMetadata>) -> bool,
{
    let (content, usage) = match provider {
        "openai" => {
            stream_openai_like(
                client,
                "https://api.openai.com/v1/chat/completions",
                api_key,
                model,
                system_prompt,
                user_prompt,
                on_chunk,
            )
            .await?
        }
        "groq" => {
            stream_openai_like(
                client,
                "https://api.groq.com/openai/v1/chat/completions",
                api_key,
                model,
                system_prompt,
                user_prompt,
                on_chunk,
            )
            .await?
        }
        "cerebras" => {
            stream_openai_like(
                client,
                "https://api.cerebras.ai/v1/chat/completions",
                api_key,
                model,
                system_prompt,
                user_prompt,
                on_chunk,
            )
            .await?
        }
        "anthropic" => {
            stream_anthropic(client, api_key, model, system_prompt, user_prompt, on_chunk).await?
        }
        "gemini" => {
            stream_gemini(client, api_key, model, system_prompt, user_prompt, on_chunk).await?
        }
        other => return Err(format!("Unsupported provider: {other}")),
    };

    if content.trim().is_empty() {
        return Err("Provider stream returned no content".to_string());
    }

    response_from_json(extract_json(&content)?, usage)
}

async fn translate_with_provider(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ProviderResponse, String> {
    match provider {
        "openai" => {
            if is_openai_responses_only_model(model) {
                call_openai_responses(client, api_key, model, system_prompt, user_prompt).await
            } else {
                call_openai_like(
                    client,
                    "https://api.openai.com/v1/chat/completions",
                    api_key,
                    model,
                    system_prompt,
                    user_prompt,
                )
                .await
            }
        }
        "groq" => {
            call_openai_like(
                client,
                "https://api.groq.com/openai/v1/chat/completions",
                api_key,
                model,
                system_prompt,
                user_prompt,
            )
            .await
        }
        "cerebras" => {
            call_openai_like(
                client,
                "https://api.cerebras.ai/v1/chat/completions",
                api_key,
                model,
                system_prompt,
                user_prompt,
            )
            .await
        }
        "anthropic" => call_anthropic(client, api_key, model, system_prompt, user_prompt).await,
        "gemini" => call_gemini(client, api_key, model, system_prompt, user_prompt).await,
        other => Err(format!("Unsupported provider: {other}")),
    }
}

fn keyring_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, provider).map_err(|e| e.to_string())
}

fn load_saved_api_key(provider: &str) -> Option<String> {
    keyring_entry(provider)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|value| !value.trim().is_empty())
}

fn set_saved_api_key(provider: &str, value: &str) -> Result<(), String> {
    let entry = keyring_entry(provider)?;
    entry.set_password(value).map_err(|e| e.to_string())
}

fn clear_saved_api_key(provider: &str) -> Result<(), String> {
    let entry = keyring_entry(provider)?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(err) => {
            let message = err.to_string();
            if message.to_lowercase().contains("no entry") {
                Ok(())
            } else {
                Err(message)
            }
        }
    }
}

fn resolve_api_key(inner: &TranslationBackendInner, provider: &str) -> Option<String> {
    inner
        .session_api_keys
        .get(provider)
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| load_saved_api_key(provider))
}

fn api_key_presence(inner: &TranslationBackendInner, provider: &str) -> ApiKeyPresence {
    let has_session = inner
        .session_api_keys
        .get(provider)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    if has_session {
        return ApiKeyPresence::Session;
    }
    if load_saved_api_key(provider).is_some() {
        return ApiKeyPresence::Stored;
    }
    ApiKeyPresence::Unset
}

fn api_key_statuses(inner: &TranslationBackendInner) -> ApiKeyStatus {
    ApiKeyStatus {
        openai: api_key_presence(inner, "openai"),
        gemini: api_key_presence(inner, "gemini"),
        anthropic: api_key_presence(inner, "anthropic"),
        groq: api_key_presence(inner, "groq"),
        cerebras: api_key_presence(inner, "cerebras"),
    }
}

#[tauri::command]
pub fn sync_translation_context(
    app: AppHandle,
    state: State<'_, TranslationBackendState>,
    payload: SyncTranslationContextPayload,
) -> Result<(), String> {
    let next = with_backend_state(&state, |inner| {
        if let Some(input_query) = payload.input_query {
            inner.state.input_query = input_query;
        }
        if let Some(source_lang) = payload.source_lang {
            inner.state.source_lang = source_lang;
        }
        if let Some(detected_lang) = payload.detected_lang {
            inner.state.detected_lang = detected_lang;
        }
        if let Some(is_detecting) = payload.is_detecting {
            inner.state.is_detecting = is_detecting;
        }
        if let Some(target_lang) = payload.target_lang {
            inner.state.target_lang = target_lang;
        }
        if let Some(style_levels) = payload.style_levels {
            inner.state.style_levels = style_levels;
        }
        if let Some(candidate_count) = payload.candidate_count {
            inner.state.candidate_count = candidate_count.clamp(1, 6);
        }
        if payload.reset_translations.unwrap_or(false) && !inner.state.is_translating {
            inner.state.detected_lang.clear();
            inner.state.translations = build_empty_translations(inner.state.candidate_count);
            inner.state.detailed_explanation = None;
            inner.state.error_message.clear();
            update_phase(&mut inner.state, TranslationPhase::Idle);
            inner.state.tech_metrics = TechMetrics {
                model: inner.state.current_model.clone(),
                stream_mode: false,
                ..Default::default()
            };
            inner.state.execution_plan = ExecutionPlanPayload::default();
        }
        set_updated(&mut inner.state);
        inner.state.clone()
    })?;
    emit_state(&app, &next);
    Ok(())
}

#[tauri::command]
pub fn request_translation_state(
    state: State<'_, TranslationBackendState>,
) -> Result<TranslationStatePayload, String> {
    with_backend_state(&state, |inner| inner.state.clone())
}

#[tauri::command]
pub fn set_api_key(
    state: State<'_, TranslationBackendState>,
    payload: ApiKeyPayload,
) -> Result<ApiKeyStatus, String> {
    with_backend_state(&state, |inner| {
        let value = payload.value.trim().to_string();

        if value.is_empty() {
            inner.session_api_keys.remove(&payload.provider);
            let _ = clear_saved_api_key(&payload.provider);
        } else if payload.persist {
            inner
                .session_api_keys
                .insert(payload.provider.clone(), value.clone());
            set_saved_api_key(&payload.provider, &value)?;
            inner.session_api_keys.remove(&payload.provider);
        } else {
            inner
                .session_api_keys
                .insert(payload.provider.clone(), value);
            let _ = clear_saved_api_key(&payload.provider);
        }
        Ok(api_key_statuses(inner))
    })?
}

#[tauri::command]
pub fn clear_api_key(
    state: State<'_, TranslationBackendState>,
    payload: ProviderPayload,
) -> Result<ApiKeyStatus, String> {
    with_backend_state(&state, |inner| {
        inner.session_api_keys.remove(&payload.provider);
        clear_saved_api_key(&payload.provider)?;
        Ok(api_key_statuses(inner))
    })?
}

#[tauri::command]
pub fn get_api_key_status(
    state: State<'_, TranslationBackendState>,
) -> Result<ApiKeyStatus, String> {
    with_backend_state(&state, |inner| api_key_statuses(inner))
}

#[tauri::command]
pub fn stop_translation(
    app: AppHandle,
    state: State<'_, TranslationBackendState>,
    _run_id: Option<u64>,
) -> Result<(), String> {
    let next = with_backend_state(&state, |inner| {
        inner.state.run_id = inner.state.run_id.saturating_add(1);
        inner.state.is_translating = false;
        inner.state.error_message.clear();
        update_phase(&mut inner.state, TranslationPhase::Stopped);
        inner.state.tech_metrics.time = 0.0;
        inner.state.tech_metrics.wait_time = 0.0;
        inner.state.tech_metrics.gen_time = 0.0;
        inner.state.tech_metrics.tokens_per_sec = 0.0;
        set_updated(&mut inner.state);
        inner.state.clone()
    })?;
    emit_state(&app, &next);
    Ok(())
}

#[tauri::command]
pub fn start_translation(
    app: AppHandle,
    state: State<'_, TranslationBackendState>,
    payload: StartTranslationPayload,
) -> Result<(), String> {
    let execution_plan = build_execution_plan(&payload.provider, &payload.model);
    let initial = with_backend_state(&state, |inner| {
        inner.state.run_id = inner.state.run_id.saturating_add(1);
        inner.state.input_query = payload.text.clone();
        inner.state.source_lang = payload.source_lang.clone();
        inner.state.detected_lang.clear();
        inner.state.is_detecting = false;
        inner.state.target_lang = payload.target_lang.clone();
        inner.state.style_levels = payload.styles.clone();
        inner.state.translations =
            build_empty_translations(payload.candidate_count.unwrap_or(3).clamp(1, 6));
        inner.state.detailed_explanation = None;
        inner.state.error_message.clear();
        inner.state.is_translating = true;
        update_phase(&mut inner.state, TranslationPhase::Submitting);
        inner.state.current_model = payload.model.clone();
        inner.state.candidate_count = payload.candidate_count.unwrap_or(3).clamp(1, 6);
        inner.state.execution_plan = execution_plan.clone();
        inner.state.tech_metrics = TechMetrics {
            model: payload.model.clone(),
            input_tokens: payload.initial_tokens.unwrap_or_default(),
            stream_mode: execution_plan.planned_mode == ExecutionMode::Stream,
            ..Default::default()
        };
        set_updated(&mut inner.state);
        inner.state.clone()
    })?;
    emit_state(&app, &initial);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let started_at = now_ms();
        let (run_id, api_key): (u64, Option<String>) =
            match app_handle.state::<TranslationBackendState>().0.lock() {
                Ok(inner) => (
                    inner.state.run_id,
                    payload
                        .api_key
                        .as_ref()
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty())
                        .or_else(|| resolve_api_key(&inner, payload.provider.as_str())),
                ),
                Err(_) => {
                    log::error!("[translation] state lock failed");
                    return;
                }
            };

        if let Ok(mut inner) = app_handle.state::<TranslationBackendState>().0.lock() {
            if inner.state.run_id == run_id {
                update_phase(&mut inner.state, TranslationPhase::WaitingModel);
                set_updated(&mut inner.state);
                emit_state(&app_handle, &inner.state);
            }
        }

        let Some(api_key) = api_key else {
            if let Ok(mut inner) = app_handle.state::<TranslationBackendState>().0.lock() {
                if inner.state.run_id == run_id {
                    inner.state.is_translating = false;
                    update_phase(&mut inner.state, TranslationPhase::Error);
                    inner.state.error_message =
                        format!("API key for {} is not configured.", payload.provider);
                    set_updated(&mut inner.state);
                    emit_state(&app_handle, &inner.state);
                }
            }
            return;
        };

        log::info!(
            "[translation] start provider={} model={} run_id={} text_len={}",
            payload.provider,
            payload.model,
            run_id,
            payload.text.len()
        );

        let system_prompt = build_system_prompt(
            payload.explanation_lang.as_deref().unwrap_or("日本語"),
            payload.candidate_count.unwrap_or(3).clamp(1, 6),
        );
        let user_prompt = build_user_prompt(
            &payload.text,
            &payload.source_lang,
            &payload.target_lang,
            &payload.styles,
            &payload.style_meta,
        );
        let client = match reqwest::Client::builder().build() {
            Ok(client) => client,
            Err(err) => {
                if let Ok(mut inner) = app_handle.state::<TranslationBackendState>().0.lock() {
                    if inner.state.run_id == run_id {
                        inner.state.is_translating = false;
                        update_phase(&mut inner.state, TranslationPhase::Error);
                        inner.state.error_message = err.to_string();
                        set_updated(&mut inner.state);
                        emit_state(&app_handle, &inner.state);
                    }
                }
                return;
            }
        };

        let backend_state = app_handle.state::<TranslationBackendState>();
        let should_attempt_stream = execution_plan.planned_mode == ExecutionMode::Stream;

        if should_attempt_stream {
            if let Ok(mut inner) = app_handle.state::<TranslationBackendState>().0.lock() {
                if inner.state.run_id == run_id {
                    inner.state.execution_plan.stream_attempted = true;
                    set_updated(&mut inner.state);
                    emit_state(&app_handle, &inner.state);
                }
            }
        }

        let (result, actual_mode, fallback_to_non_stream) = if should_attempt_stream {
            match translate_with_provider_streaming(
                &client,
                &payload.provider,
                &api_key,
                &payload.model,
                &system_prompt,
                &user_prompt,
                |content, usage| {
                    apply_partial_stream_update(
                        &app_handle,
                        &backend_state,
                        run_id,
                        started_at,
                        content,
                        usage,
                    )
                },
            )
            .await
            {
                Ok(response) => (Ok(response), ExecutionMode::Stream, false),
                Err(stream_error) => {
                    log::warn!(
                        "[translation] stream fallback provider={} model={} run_id={} error={}",
                        payload.provider,
                        payload.model,
                        run_id,
                        stream_error
                    );
                    (
                        translate_with_provider(
                            &client,
                            &payload.provider,
                            &api_key,
                            &payload.model,
                            &system_prompt,
                            &user_prompt,
                        )
                        .await,
                        ExecutionMode::NonStream,
                        true,
                    )
                }
            }
        } else {
            (
                translate_with_provider(
                    &client,
                    &payload.provider,
                    &api_key,
                    &payload.model,
                    &system_prompt,
                    &user_prompt,
                )
                .await,
                ExecutionMode::NonStream,
                false,
            )
        };

        if let Ok(mut inner) = app_handle.state::<TranslationBackendState>().0.lock() {
            if inner.state.run_id != run_id {
                return;
            }

            inner.state.execution_plan.actual_mode = actual_mode;
            inner.state.execution_plan.stream_attempted = should_attempt_stream;
            inner.state.execution_plan.fallback_to_non_stream = fallback_to_non_stream;
            inner.state.tech_metrics.stream_mode = actual_mode == ExecutionMode::Stream;

            match result {
                Ok(response) => {
                    inner.state.detected_lang = response.detected_source_language;
                    inner.state.translations = response
                        .candidates
                        .into_iter()
                        .enumerate()
                        .map(|(idx, mut item)| {
                            item.id = Some((idx + 1) as u32);
                            item
                        })
                        .collect();
                    inner.state.detailed_explanation = response.detailed_explanation;
                    inner.state.error_message.clear();
                    inner.state.tech_metrics.time =
                        (now_ms().saturating_sub(started_at) as f64) / 1000.0;
                    if !inner.state.tech_metrics.first_token_received {
                        inner.state.tech_metrics.wait_time = inner.state.tech_metrics.time;
                        inner.state.tech_metrics.first_token_received = true;
                    }
                    inner.state.tech_metrics.gen_time = (inner.state.tech_metrics.time
                        - inner.state.tech_metrics.wait_time)
                        .max(0.0);
                    if let Some(usage) = response.usage {
                        inner.state.tech_metrics.input_tokens = usage.input_tokens;
                        inner.state.tech_metrics.output_tokens = usage.output_tokens;
                        inner.state.tech_metrics.is_real = true;
                    }
                    if inner.state.tech_metrics.gen_time > 0.0
                        && inner.state.tech_metrics.output_tokens > 0
                    {
                        inner.state.tech_metrics.tokens_per_sec =
                            inner.state.tech_metrics.output_tokens as f64
                                / inner.state.tech_metrics.gen_time;
                    }
                    update_phase(&mut inner.state, TranslationPhase::Idle);
                }
                Err(err) => {
                    update_phase(&mut inner.state, TranslationPhase::Error);
                    inner.state.error_message = err;
                    inner.state.translations =
                        build_empty_translations(inner.state.candidate_count);
                    inner.state.detailed_explanation = None;
                    inner.state.tech_metrics.time =
                        (now_ms().saturating_sub(started_at) as f64) / 1000.0;
                }
            }

            inner.state.is_translating = false;
            set_updated(&mut inner.state);
            emit_state(&app_handle, &inner.state);
        }
    });

    Ok(())
}
