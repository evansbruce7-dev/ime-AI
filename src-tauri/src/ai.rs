//! OpenAI-compatible `chat/completions` client for LM Studio and OpenRouter.

use crate::config::{AppSettings, LlmProvider};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error: {0}")]
    Api(String),
    #[error("empty completion")]
    Empty,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    temperature: f32,
}

#[derive(Debug, Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Option<Vec<Choice>>,
    error: Option<ApiErrBody>,
    usage: Option<UsageBody>,
}

/// OpenAI-compatible `usage` (OpenRouter / LM Studio often include this on chat completions).
#[derive(Debug, Deserialize)]
struct UsageBody {
    total_tokens: Option<u64>,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

fn usage_total_tokens(u: &UsageBody) -> Option<u64> {
    if let Some(t) = u.total_tokens {
        return Some(t);
    }
    match (u.prompt_tokens, u.completion_tokens) {
        (Some(p), Some(c)) => Some(p.saturating_add(c)),
        _ => None,
    }
}

#[derive(Debug)]
pub struct ChatCompletionResult {
    pub text: String,
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Option<Message>,
}

#[derive(Debug, Deserialize)]
struct ApiErrBody {
    message: Option<String>,
}

fn chat_completions_url(settings: &AppSettings) -> String {
    format!(
        "{}/chat/completions",
        settings.base_url.trim_end_matches('/')
    )
}

fn models_list_url(settings: &AppSettings) -> String {
    format!("{}/models", settings.base_url.trim_end_matches('/'))
}

/// OpenRouter allows unauthenticated `GET /v1/models` in many cases, but chat endpoints require
/// `Authorization: Bearer`. Missing key surfaces as 401 with a confusing "cookie" message upstream.
fn openrouter_key_configured(api_key: Option<&str>) -> bool {
    api_key.map(|s| !s.trim().is_empty()).unwrap_or(false)
}

/// Fails fast with a clear message when a cloud provider is selected but no key is stored.
fn ensure_api_key_if_needed(settings: &AppSettings, api_key: Option<&str>) -> Result<(), LlmError> {
    if !settings.provider.requires_api_key() {
        return Ok(());
    }
    if openrouter_key_configured(api_key) {
        return Ok(());
    }
    Err(LlmError::Api(format!(
        "未找到 {} API Key：请在「模型与连接」填写密钥并点击「保存模型设置」。",
        settings.provider.display_name()
    )))
}

fn apply_provider_headers(
    settings: &AppSettings,
    api_key: Option<&str>,
    req: reqwest::RequestBuilder,
) -> reqwest::RequestBuilder {
    let mut req = req;
    if let Some(key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    if settings.provider == LlmProvider::OpenRouter {
        if let Some(ref u) = settings.openrouter_site_url {
            req = req.header("HTTP-Referer", u);
        }
        if let Some(ref n) = settings.openrouter_app_name {
            req = req.header("X-Title", n);
        }
    }
    req
}

/// Non-streaming chat completion; returns assistant text plus optional `usage.total_tokens` when present.
pub async fn chat_completion(
    client: &reqwest::Client,
    settings: &AppSettings,
    api_key: Option<&str>,
    user_prompt: &str,
) -> Result<ChatCompletionResult, LlmError> {
    ensure_api_key_if_needed(settings, api_key)?;
    let url = chat_completions_url(settings);
    let body = ChatRequest {
        model: settings.model.clone(),
        messages: vec![Message {
            role: "user".into(),
            content: user_prompt.into(),
        }],
        temperature: 0.7,
    };

    let to = Duration::from_secs(settings.timeout_secs.max(5));
    let req = apply_provider_headers(settings, api_key, client.post(&url).json(&body).timeout(to));

    println!(
        "[ai] POST {} model={} timeout={}s prompt_chars={}",
        url,
        settings.model,
        settings.timeout_secs,
        user_prompt.chars().count()
    );

    let started = Instant::now();
    let resp = req.send().await?;
    let headers_ms = started.elapsed().as_millis();
    let status = resp.status();
    let resp = resp.error_for_status()?;
    let parsed: ChatResponse = resp.json().await?;
    let total_ms = started.elapsed().as_millis();

    if let Some(e) = parsed.error {
        let msg = e.message.unwrap_or_else(|| "unknown API error".into());
        return Err(LlmError::Api(msg));
    }

    let text = parsed
        .choices
        .as_ref()
        .and_then(|c| c.first())
        .and_then(|c| c.message.as_ref())
        .map(|m| m.content.trim().to_string())
        .filter(|s| !s.is_empty());

    let text = text.ok_or(LlmError::Empty)?;
    let total_tokens = parsed.usage.as_ref().and_then(usage_total_tokens);
    if let Some(t) = total_tokens {
        println!("[ai] usage total_tokens={}", t);
    }
    println!(
        "[ai] response status={} headers_ms={} decode_ms={} total_ms={} output_chars={}",
        status,
        headers_ms,
        total_ms.saturating_sub(headers_ms),
        total_ms,
        text.chars().count()
    );
    Ok(ChatCompletionResult { text, total_tokens })
}

/// Stream chat completion (SSE). Calls `on_delta` for each non-empty text fragment.
/// Returns assembled text, optional usage tokens, and whether the caller cancelled via `cancel`.
pub async fn chat_completion_streaming<F>(
    client: &reqwest::Client,
    settings: &AppSettings,
    api_key: Option<&str>,
    user_prompt: &str,
    cancel: &AtomicBool,
    mut on_delta: F,
) -> Result<(ChatCompletionResult, bool), LlmError>
where
    F: FnMut(&str),
{
    ensure_api_key_if_needed(settings, api_key)?;
    let url = chat_completions_url(settings);
    let body = json!({
        "model": settings.model,
        "messages": [{"role": "user", "content": user_prompt}],
        "temperature": 0.7,
        "stream": true,
    });
    let to = Duration::from_secs(settings.timeout_secs.max(5));
    let req = apply_provider_headers(settings, api_key, client.post(&url).json(&body).timeout(to));

    println!(
        "[ai] POST {} stream model={} timeout={}s prompt_chars={}",
        url,
        settings.model,
        settings.timeout_secs,
        user_prompt.chars().count()
    );

    let started = Instant::now();
    let resp = req.send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(LlmError::Api(format!("{} — {}", status, t)));
    }

    let mut stream = resp.bytes_stream();
    let mut pending: Vec<u8> = Vec::new();
    let mut assembled = String::new();
    let mut last_usage_tokens: Option<u64> = None;

    while let Some(item) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            println!(
                "[ai] stream cancelled after {} ms chars={}",
                started.elapsed().as_millis(),
                assembled.chars().count()
            );
            return Ok((
                ChatCompletionResult {
                    text: assembled,
                    total_tokens: last_usage_tokens,
                },
                true,
            ));
        }
        let chunk = item?;
        pending.extend_from_slice(&chunk);
        while let Some(pos) = pending.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = pending.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
            if line.is_empty() {
                continue;
            }
            if line.starts_with(':') {
                continue;
            }
            let rest = match line.strip_prefix("data:") {
                Some(s) => s.trim(),
                None => continue,
            };
            if rest == "[DONE]" {
                println!(
                    "[ai] stream [DONE] total_ms={} output_chars={}",
                    started.elapsed().as_millis(),
                    assembled.chars().count()
                );
                if assembled.trim().is_empty() {
                    return Err(LlmError::Empty);
                }
                return Ok((
                    ChatCompletionResult {
                        text: assembled,
                        total_tokens: last_usage_tokens,
                    },
                    false,
                ));
            }
            let v: serde_json::Value = serde_json::from_str(rest).map_err(|e| {
                LlmError::Api(format!(
                    "stream JSON parse error: {} line={}",
                    e,
                    rest.chars().take(160).collect::<String>()
                ))
            })?;
            if let Some(err) = v.get("error") {
                let msg = err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("stream error");
                return Err(LlmError::Api(msg.into()));
            }
            if let Some(u) = v.get("usage") {
                if let Ok(uu) = serde_json::from_value::<UsageBody>(u.clone()) {
                    last_usage_tokens = usage_total_tokens(&uu).or(last_usage_tokens);
                }
            }
            let piece = v
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|c0| c0.get("delta"))
                .and_then(|d| d.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("");
            if !piece.is_empty() {
                assembled.push_str(piece);
                on_delta(piece);
            }
        }
    }

    if assembled.trim().is_empty() {
        return Err(LlmError::Empty);
    }
    println!(
        "[ai] stream ended without [DONE] total_ms={} output_chars={}",
        started.elapsed().as_millis(),
        assembled.chars().count()
    );
    Ok((
        ChatCompletionResult {
            text: assembled,
            total_tokens: last_usage_tokens,
        },
        false,
    ))
}

/// Returns sorted unique model ids from `GET /v1/models` when the server follows OpenAI list shape.
pub async fn list_model_ids(
    client: &reqwest::Client,
    settings: &AppSettings,
    api_key: Option<&str>,
) -> Result<Vec<String>, LlmError> {
    ensure_api_key_if_needed(settings, api_key)?;
    let url = models_list_url(settings);
    let to = Duration::from_secs(settings.timeout_secs.max(5));
    let req = apply_provider_headers(settings, api_key, client.get(&url).timeout(to));
    println!("[ai] GET {}", url);
    let resp = req.send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(LlmError::Api(format!("{} — {}", status, t)));
    }
    let v: serde_json::Value = resp.json().await?;
    let mut ids: Vec<String> = Vec::new();
    if let Some(arr) = v.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                if !id.is_empty() {
                    ids.push(id.to_string());
                }
            }
        }
    }
    if ids.is_empty() {
        return Err(LlmError::Api(
            "/models 响应中未找到 data[].id 列表（可能不是 OpenAI 兼容列表格式）".into(),
        ));
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Lightweight connectivity check: GET `/models` — many servers support GET /v1/models.
pub async fn test_connection(
    client: &reqwest::Client,
    settings: &AppSettings,
    api_key: Option<&str>,
) -> Result<String, LlmError> {
    ensure_api_key_if_needed(settings, api_key)?;
    let url = models_list_url(settings);
    let to = Duration::from_secs(settings.timeout_secs.max(5));
    let req = apply_provider_headers(settings, api_key, client.get(&url).timeout(to));
    println!("[ai] test GET {}", url);
    let resp = req.send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(LlmError::Api(format!("{} — {}", status, t)));
    }
    let v: serde_json::Value = resp.json().await?;
    Ok(json!(v).to_string())
}
