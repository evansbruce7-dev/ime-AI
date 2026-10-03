//! Dedicated machine-translation providers (DeepL, Baidu, Youdao, Azure, Google).
//! Used only for translate_* commands when `translation.provider` is not `Llm`.

use crate::config::{TranslationProvider, TranslationSettings};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TranslateError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error: {0}")]
    Api(String),
    #[error("missing credentials: {0}")]
    MissingCreds(String),
    #[error("empty translation")]
    Empty,
}

/// Map built-in command ids to (source_lang_hint, target_lang) for dedicated APIs.
/// Returns `None` when the command is not a translation command.
pub fn translate_langs_for_command(command_id: &str) -> Option<(&'static str, &'static str)> {
    match command_id {
        "translate_zh" => Some(("auto", "zh")),
        "translate_en" => Some(("auto", "en")),
        _ => None,
    }
}

/// Whether this command should be routed through a dedicated translation API.
pub fn should_use_translation_api(
    settings: &TranslationSettings,
    command_id: Option<&str>,
) -> bool {
    if settings.provider == TranslationProvider::Llm {
        return false;
    }
    command_id
        .map(|id| translate_langs_for_command(id).is_some())
        .unwrap_or(false)
}

/// Translate `text` using the configured dedicated provider.
pub async fn translate_text(
    client: &reqwest::Client,
    settings: &TranslationSettings,
    api_key: Option<&str>,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, TranslateError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(TranslateError::Empty);
    }
    println!(
        "[translate] provider={:?} src={} tgt={} chars={}",
        settings.provider,
        source_lang,
        target_lang,
        text.chars().count()
    );
    match settings.provider {
        TranslationProvider::Llm => Err(TranslateError::Api(
            "translation provider is LLM — use chat completion path".into(),
        )),
        TranslationProvider::Deepl => {
            translate_deepl(client, settings, api_key, text, source_lang, target_lang).await
        }
        TranslationProvider::Baidu => {
            translate_baidu(client, settings, api_key, text, source_lang, target_lang).await
        }
        TranslationProvider::Youdao => {
            translate_youdao(client, settings, api_key, text, source_lang, target_lang).await
        }
        TranslationProvider::Azure => {
            translate_azure(client, settings, api_key, text, source_lang, target_lang).await
        }
        TranslationProvider::Google => {
            translate_google(client, api_key, text, source_lang, target_lang).await
        }
    }
}

// ---------------------------------------------------------------------------
// DeepL — POST /v2/translate, Authorization: DeepL-Auth-Key …
// ---------------------------------------------------------------------------

fn deepl_target_lang(lang: &str) -> String {
    match lang.to_lowercase().as_str() {
        "zh" | "zh-cn" | "zh-hans" => "ZH".into(),
        "en" => "EN".into(),
        "ja" => "JA".into(),
        "ko" => "KO".into(),
        "de" => "DE".into(),
        "fr" => "FR".into(),
        "es" => "ES".into(),
        "pt" => "PT".into(),
        "ru" => "RU".into(),
        other => other.to_uppercase(),
    }
}

fn deepl_source_lang(lang: &str) -> Option<String> {
    let l = lang.to_lowercase();
    if l == "auto" || l.is_empty() {
        return None;
    }
    Some(deepl_target_lang(&l))
}

#[derive(Debug, Deserialize)]
struct DeeplResponse {
    translations: Option<Vec<DeeplTranslation>>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeeplTranslation {
    text: Option<String>,
}

async fn translate_deepl(
    client: &reqwest::Client,
    settings: &TranslationSettings,
    api_key: Option<&str>,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, TranslateError> {
    let key = api_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| TranslateError::MissingCreds("DeepL API Key".into()))?;

    let host = if settings.deepl_use_free_api || key.ends_with(":fx") {
        "https://api-free.deepl.com"
    } else {
        "https://api.deepl.com"
    };
    let url = format!("{host}/v2/translate");

    let mut body = json!({
        "text": [text],
        "target_lang": deepl_target_lang(target_lang),
    });
    if let Some(src) = deepl_source_lang(source_lang) {
        body["source_lang"] = json!(src);
    }

    println!("[translate] DeepL POST {url}");
    let resp = client
        .post(&url)
        .header("Authorization", format!("DeepL-Auth-Key {key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(30))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(TranslateError::Api(format!("DeepL {status} — {t}")));
    }

    let parsed: DeeplResponse = resp.json().await?;
    if let Some(msg) = parsed.message {
        return Err(TranslateError::Api(msg));
    }
    let out = parsed
        .translations
        .as_ref()
        .and_then(|t| t.first())
        .and_then(|t| t.text.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or(TranslateError::Empty)?;
    println!("[translate] DeepL OK chars={}", out.chars().count());
    Ok(out)
}

// ---------------------------------------------------------------------------
// Baidu — GET/POST fanyi-api.baidu.com, MD5(appid+q+salt+secret)
// ---------------------------------------------------------------------------

fn baidu_lang(lang: &str) -> String {
    match lang.to_lowercase().as_str() {
        "zh" | "zh-cn" | "zh-hans" => "zh".into(),
        "en" => "en".into(),
        "ja" => "jp".into(),
        "ko" => "kor".into(),
        "auto" | "" => "auto".into(),
        other => other.to_string(),
    }
}

fn md5_hex(s: &str) -> String {
    // Minimal MD5 without extra crate: use a tiny public-domain implementation inline.
    // Prefer `md-5` crate if available; we add it to Cargo.toml.
    use md5::{Digest, Md5};
    let mut hasher = Md5::new();
    hasher.update(s.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Debug, Deserialize)]
struct BaiduResponse {
    error_code: Option<String>,
    error_msg: Option<String>,
    trans_result: Option<Vec<BaiduTransItem>>,
}

#[derive(Debug, Deserialize)]
struct BaiduTransItem {
    dst: Option<String>,
}

async fn translate_baidu(
    client: &reqwest::Client,
    settings: &TranslationSettings,
    api_key: Option<&str>,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, TranslateError> {
    let app_id = settings.baidu_app_id.trim();
    if app_id.is_empty() {
        return Err(TranslateError::MissingCreds("百度翻译 APP ID".into()));
    }
    let secret = api_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| TranslateError::MissingCreds("百度翻译密钥".into()))?;

    let salt = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    // Sign with raw `q` (no URL-encode) per Baidu docs.
    let sign_raw = format!("{app_id}{text}{salt}{secret}");
    let sign = md5_hex(&sign_raw);

    let url = "https://fanyi-api.baidu.com/api/trans/vip/translate";
    println!("[translate] Baidu POST {url}");
    let resp = client
        .post(url)
        .form(&[
            ("q", text),
            ("from", &baidu_lang(source_lang)),
            ("to", &baidu_lang(target_lang)),
            ("appid", app_id),
            ("salt", &salt),
            ("sign", &sign),
        ])
        .timeout(Duration::from_secs(30))
        .send()
        .await?;

    let parsed: BaiduResponse = resp.json().await?;
    if let Some(code) = parsed.error_code {
        if code != "0" {
            let msg = parsed.error_msg.unwrap_or_default();
            return Err(TranslateError::Api(format!("百度翻译 {code}: {msg}")));
        }
    }
    let out = parsed
        .trans_result
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| i.dst)
        .collect::<Vec<_>>()
        .join("\n");
    let out = out.trim().to_string();
    if out.is_empty() {
        return Err(TranslateError::Empty);
    }
    println!("[translate] Baidu OK chars={}", out.chars().count());
    Ok(out)
}

// ---------------------------------------------------------------------------
// Youdao — POST openapi.youdao.com/api, SHA256(appKey+input+salt+curtime+secret)
// ---------------------------------------------------------------------------

fn youdao_lang(lang: &str) -> String {
    match lang.to_lowercase().as_str() {
        "zh" | "zh-cn" | "zh-hans" => "zh-CHS".into(),
        "en" => "en".into(),
        "ja" => "ja".into(),
        "ko" => "ko".into(),
        "auto" | "" => "auto".into(),
        other => other.to_string(),
    }
}

fn youdao_input_truncate(q: &str) -> String {
    let chars: Vec<char> = q.chars().collect();
    let len = chars.len();
    if len <= 20 {
        return q.to_string();
    }
    let head: String = chars.iter().take(10).collect();
    let tail: String = chars.iter().skip(len - 10).collect();
    format!("{head}{len}{tail}")
}

fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Debug, Deserialize)]
struct YoudaoResponse {
    #[serde(rename = "errorCode")]
    error_code: Option<String>,
    translation: Option<Vec<String>>,
}

async fn translate_youdao(
    client: &reqwest::Client,
    settings: &TranslationSettings,
    api_key: Option<&str>,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, TranslateError> {
    let app_key = settings.youdao_app_key.trim();
    if app_key.is_empty() {
        return Err(TranslateError::MissingCreds("有道翻译 appKey".into()));
    }
    let secret = api_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| TranslateError::MissingCreds("有道翻译应用密钥".into()))?;

    let salt = uuid_like();
    let curtime = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    );
    let input = youdao_input_truncate(text);
    let sign_str = format!("{app_key}{input}{salt}{curtime}{secret}");
    let sign = sha256_hex(&sign_str);

    let url = "https://openapi.youdao.com/api";
    println!("[translate] Youdao POST {url}");
    let resp = client
        .post(url)
        .form(&[
            ("q", text),
            ("from", &youdao_lang(source_lang)),
            ("to", &youdao_lang(target_lang)),
            ("appKey", app_key),
            ("salt", &salt),
            ("sign", &sign),
            ("signType", "v3"),
            ("curtime", &curtime),
        ])
        .timeout(Duration::from_secs(30))
        .send()
        .await?;

    let parsed: YoudaoResponse = resp.json().await?;
    if let Some(code) = parsed.error_code {
        if code != "0" {
            return Err(TranslateError::Api(format!("有道翻译 errorCode={code}")));
        }
    }
    let out = parsed
        .translation
        .unwrap_or_default()
        .join("\n")
        .trim()
        .to_string();
    if out.is_empty() {
        return Err(TranslateError::Empty);
    }
    println!("[translate] Youdao OK chars={}", out.chars().count());
    Ok(out)
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

// ---------------------------------------------------------------------------
// Azure Translator v3
// ---------------------------------------------------------------------------

fn azure_lang(lang: &str) -> String {
    match lang.to_lowercase().as_str() {
        "zh" | "zh-cn" | "zh-hans" => "zh-Hans".into(),
        "en" => "en".into(),
        "ja" => "ja".into(),
        "ko" => "ko".into(),
        "auto" | "" => String::new(),
        other => other.to_string(),
    }
}

#[derive(Debug, Deserialize)]
struct AzureItem {
    translations: Option<Vec<AzureTranslation>>,
}

#[derive(Debug, Deserialize)]
struct AzureTranslation {
    text: Option<String>,
}

async fn translate_azure(
    client: &reqwest::Client,
    settings: &TranslationSettings,
    api_key: Option<&str>,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, TranslateError> {
    let key = api_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| TranslateError::MissingCreds("Azure Translator Key".into()))?;

    let host = {
        let ep = settings.azure_endpoint.trim().trim_end_matches('/');
        if ep.is_empty() {
            "https://api.cognitive.microsofttranslator.com".to_string()
        } else if ep.starts_with("http") {
            ep.to_string()
        } else {
            format!("https://{ep}")
        }
    };

    let to = azure_lang(target_lang);
    let mut url = format!("{host}/translate?api-version=3.0&to={to}");
    let from = azure_lang(source_lang);
    if !from.is_empty() {
        url.push_str(&format!("&from={from}"));
    }

    println!("[translate] Azure POST {url}");
    let mut req = client
        .post(&url)
        .header("Ocp-Apim-Subscription-Key", key)
        .header("Content-Type", "application/json")
        .json(&json!([{ "Text": text }]))
        .timeout(Duration::from_secs(30));

    let region = settings.azure_region.trim();
    if !region.is_empty() {
        req = req.header("Ocp-Apim-Subscription-Region", region);
    }

    let resp = req.send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(TranslateError::Api(format!("Azure {status} — {t}")));
    }

    let parsed: Vec<AzureItem> = resp.json().await?;
    let out = parsed
        .first()
        .and_then(|i| i.translations.as_ref())
        .and_then(|t| t.first())
        .and_then(|t| t.text.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or(TranslateError::Empty)?;
    println!("[translate] Azure OK chars={}", out.chars().count());
    Ok(out)
}

// ---------------------------------------------------------------------------
// Google Cloud Translation API v2 (API key)
// ---------------------------------------------------------------------------

fn google_lang(lang: &str) -> String {
    match lang.to_lowercase().as_str() {
        "zh" | "zh-cn" | "zh-hans" => "zh-CN".into(),
        "en" => "en".into(),
        "ja" => "ja".into(),
        "ko" => "ko".into(),
        "auto" | "" => String::new(),
        other => other.to_string(),
    }
}

#[derive(Debug, Deserialize)]
struct GoogleResponse {
    data: Option<GoogleData>,
    error: Option<GoogleError>,
}

#[derive(Debug, Deserialize)]
struct GoogleData {
    translations: Option<Vec<GoogleTranslation>>,
}

#[derive(Debug, Deserialize)]
struct GoogleTranslation {
    #[serde(rename = "translatedText")]
    translated_text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleError {
    message: Option<String>,
}

async fn translate_google(
    client: &reqwest::Client,
    api_key: Option<&str>,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, TranslateError> {
    let key = api_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| TranslateError::MissingCreds("Google Cloud Translation API Key".into()))?;

    let url = format!("https://translation.googleapis.com/language/translate/v2?key={key}");
    let mut body = json!({
        "q": text,
        "target": google_lang(target_lang),
        "format": "text",
    });
    let from = google_lang(source_lang);
    if !from.is_empty() {
        body["source"] = json!(from);
    }

    println!("[translate] Google POST translation.googleapis.com");
    let resp = client
        .post(&url)
        .json(&body)
        .timeout(Duration::from_secs(30))
        .send()
        .await?;

    let parsed: GoogleResponse = resp.json().await?;
    if let Some(err) = parsed.error {
        return Err(TranslateError::Api(
            err.message
                .unwrap_or_else(|| "Google Translate error".into()),
        ));
    }
    let out = parsed
        .data
        .and_then(|d| d.translations)
        .and_then(|t| t.into_iter().next())
        .and_then(|t| t.translated_text)
        .map(|s| html_unescape(&s))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or(TranslateError::Empty)?;
    println!("[translate] Google OK chars={}", out.chars().count());
    Ok(out)
}

fn html_unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}
