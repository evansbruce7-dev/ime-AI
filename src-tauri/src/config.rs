//! Persistent settings: LLM endpoint, model competition, translation APIs, and shortcuts.
//! API keys are stored separately via the system keyring / app-data mirror (see `secrets.rs`).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// LLM provider presets (OpenAI-compatible chat + /models)
// ---------------------------------------------------------------------------

/// Which upstream profile the user selected (affects default base URL and auth).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LlmProvider {
    LmStudio,
    OpenRouter,
    /// Official OpenAI API (`https://api.openai.com/v1`).
    Openai,
    /// NVIDIA NIM / NVIDIA API Catalog (`https://integrate.api.nvidia.com/v1`).
    NvidiaNim,
    /// DeepSeek OpenAI-compatible API.
    Deepseek,
    /// Groq OpenAI-compatible API.
    Groq,
    /// Together AI.
    Together,
    /// SiliconFlow (硅基流动).
    Siliconflow,
    /// Moonshot / Kimi.
    Moonshot,
    /// Any other OpenAI-compatible base URL.
    Custom,
}

impl Default for LlmProvider {
    fn default() -> Self {
        LlmProvider::LmStudio
    }
}

impl LlmProvider {
    /// Human-readable label for logs / UI chips.
    pub fn display_name(&self) -> &'static str {
        match self {
            LlmProvider::LmStudio => "LM Studio",
            LlmProvider::OpenRouter => "OpenRouter",
            LlmProvider::Openai => "OpenAI",
            LlmProvider::NvidiaNim => "NVIDIA NIM",
            LlmProvider::Deepseek => "DeepSeek",
            LlmProvider::Groq => "Groq",
            LlmProvider::Together => "Together",
            LlmProvider::Siliconflow => "SiliconFlow",
            LlmProvider::Moonshot => "Moonshot",
            LlmProvider::Custom => "自定义 API",
        }
    }

    /// Default OpenAI-compatible base URL for this preset (empty for Custom).
    pub fn default_base_url(&self) -> &'static str {
        match self {
            LlmProvider::LmStudio => "http://127.0.0.1:1234/v1",
            LlmProvider::OpenRouter => "https://openrouter.ai/api/v1",
            LlmProvider::Openai => "https://api.openai.com/v1",
            LlmProvider::NvidiaNim => "https://integrate.api.nvidia.com/v1",
            LlmProvider::Deepseek => "https://api.deepseek.com/v1",
            LlmProvider::Groq => "https://api.groq.com/openai/v1",
            LlmProvider::Together => "https://api.together.xyz/v1",
            LlmProvider::Siliconflow => "https://api.siliconflow.cn/v1",
            LlmProvider::Moonshot => "https://api.moonshot.cn/v1",
            LlmProvider::Custom => "",
        }
    }

    /// Whether this provider typically needs a Bearer API key.
    pub fn requires_api_key(&self) -> bool {
        !matches!(self, LlmProvider::LmStudio | LlmProvider::Custom)
    }

    /// Stable string id used as the secrets storage slot name.
    pub fn secret_slot(&self) -> &'static str {
        match self {
            LlmProvider::LmStudio => "lm_studio",
            LlmProvider::OpenRouter => "open_router",
            LlmProvider::Openai => "openai",
            LlmProvider::NvidiaNim => "nvidia_nim",
            LlmProvider::Deepseek => "deepseek",
            LlmProvider::Groq => "groq",
            LlmProvider::Together => "together",
            LlmProvider::Siliconflow => "siliconflow",
            LlmProvider::Moonshot => "moonshot",
            LlmProvider::Custom => "custom",
        }
    }
}

fn default_inject_shortcut() -> String {
    "ctrl+shift+i".to_string()
}

/// How the floating panel interacts with other windows on the z-order.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PanelZorderMode {
    /// Normal window: other apps can cover it.
    #[default]
    Default,
    /// Stay topmost while the panel has focus, drop to normal when it loses focus.
    Upper,
    /// Always topmost; cannot be covered by other apps.
    AlwaysTop,
}

impl PanelZorderMode {
    /// Parse from the wire representation used by the frontend.
    pub fn from_wire(s: &str) -> Option<Self> {
        match s {
            "default" => Some(Self::Default),
            "upper" => Some(Self::Upper),
            "always_top" => Some(Self::AlwaysTop),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Model competition: multi-candidate scoring + dynamic switch
// ---------------------------------------------------------------------------

/// One candidate model that can participate in competition scoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompetitionCandidate {
    /// Stable id (uuid-like string from the UI).
    pub id: String,
    /// Display label shown in the AI panel.
    pub label: String,
    pub provider: LlmProvider,
    pub base_url: String,
    pub model: String,
    /// Whether this candidate is included when competition is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// User-configured average cost per 1K tokens (currency-agnostic units).
    #[serde(default)]
    pub cost_per_1k_tokens: f64,
    /// Optional manual throughput override (tokens/sec). `None` → use measured average.
    #[serde(default)]
    pub manual_throughput_tps: Option<f64>,
    /// Last measured connection latency in milliseconds (`GET /models` RTT).
    #[serde(default)]
    pub measured_latency_ms: Option<f64>,
    /// Rolling average of observed generation throughput (tokens/sec) from real runs.
    #[serde(default)]
    pub measured_throughput_tps: Option<f64>,
    /// Unix epoch seconds of the last successful probe (connection test).
    #[serde(default)]
    pub last_probe_unix: Option<u64>,
}

fn default_true() -> bool {
    true
}

fn default_probe_interval_secs() -> u64 {
    300
}

fn default_weight_latency() -> f64 {
    0.35
}

fn default_weight_throughput() -> f64 {
    0.40
}

fn default_weight_cost() -> f64 {
    0.25
}

/// Model competition settings. Algorithm runs **only** when `enabled` is true.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompetitionSettings {
    /// Master switch — default off. When false, the app uses the global provider/model only.
    #[serde(default)]
    pub enabled: bool,
    /// How often (seconds) to auto-probe connection latency for enabled candidates.
    #[serde(default = "default_probe_interval_secs")]
    pub probe_interval_secs: u64,
    /// Relative weight for connection speed (lower latency = better).
    #[serde(default = "default_weight_latency")]
    pub weight_latency: f64,
    /// Relative weight for throughput (higher tokens/sec = better).
    #[serde(default = "default_weight_throughput")]
    pub weight_throughput: f64,
    /// Relative weight for cost (lower cost/1k tokens = better).
    #[serde(default = "default_weight_cost")]
    pub weight_cost: f64,
    /// Competing model list (shown in the AI panel when competition is on).
    #[serde(default)]
    pub candidates: Vec<CompetitionCandidate>,
    /// Id of the currently selected best candidate (updated by the scorer).
    #[serde(default)]
    pub active_candidate_id: Option<String>,
}

impl Default for CompetitionSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            probe_interval_secs: default_probe_interval_secs(),
            weight_latency: default_weight_latency(),
            weight_throughput: default_weight_throughput(),
            weight_cost: default_weight_cost(),
            candidates: Vec::new(),
            active_candidate_id: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Dedicated translation APIs (non-LLM)
// ---------------------------------------------------------------------------

/// Dedicated machine-translation provider (used only for translate commands).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TranslationProvider {
    /// Fall back to the LLM prompt commands (existing behaviour).
    #[default]
    Llm,
    Deepl,
    Baidu,
    Youdao,
    Azure,
    Google,
}

impl TranslationProvider {
    pub fn secret_slot(&self) -> &'static str {
        match self {
            TranslationProvider::Llm => "translation_llm",
            TranslationProvider::Deepl => "translation_deepl",
            TranslationProvider::Baidu => "translation_baidu",
            TranslationProvider::Youdao => "translation_youdao",
            TranslationProvider::Azure => "translation_azure",
            TranslationProvider::Google => "translation_google",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            TranslationProvider::Llm => "大模型提示词",
            TranslationProvider::Deepl => "DeepL",
            TranslationProvider::Baidu => "百度翻译",
            TranslationProvider::Youdao => "有道翻译",
            TranslationProvider::Azure => "Azure Translator",
            TranslationProvider::Google => "Google Cloud Translation",
        }
    }
}

/// Settings for dedicated translation services (API keys live in `secrets`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationSettings {
    #[serde(default)]
    pub provider: TranslationProvider,
    /// DeepL Free uses `api-free.deepl.com`; Pro uses `api.deepl.com`.
    #[serde(default)]
    pub deepl_use_free_api: bool,
    /// Baidu Translate APP ID (sign uses appid + secret).
    #[serde(default)]
    pub baidu_app_id: String,
    /// Youdao appKey (sign uses appKey + secret).
    #[serde(default)]
    pub youdao_app_key: String,
    /// Azure Translator region (e.g. `eastasia`); required for multi-service keys.
    #[serde(default)]
    pub azure_region: String,
    /// Optional Azure custom endpoint host (empty → global cognitive endpoint).
    #[serde(default)]
    pub azure_endpoint: String,
    /// Google Cloud Translation API key mode (v2) — project id optional for logging.
    #[serde(default)]
    pub google_project_id: String,
}

impl Default for TranslationSettings {
    fn default() -> Self {
        Self {
            provider: TranslationProvider::Llm,
            deepl_use_free_api: true,
            baidu_app_id: String::new(),
            youdao_app_key: String::new(),
            azure_region: String::new(),
            azure_endpoint: String::new(),
            google_project_id: String::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Processing queue defaults (panel frontend orchestrates; settings only)
// ---------------------------------------------------------------------------

fn default_queue_command_id() -> String {
    "translate_en".to_string()
}

fn default_max_queue_size() -> u32 {
    10
}

/// Default options for the AI panel processing queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueSettings {
    /// Master switch — when false, Ctrl+Enter runs a single job (legacy).
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Default command id applied to new queue items (and panel bootstrap).
    #[serde(default = "default_queue_command_id")]
    pub default_command_id: String,
    /// When true, enqueueing starts / continues the sequential worker.
    #[serde(default = "default_true")]
    pub auto_start_on_enqueue: bool,
    /// Max pending+active items (also drives history capacity). Clamped 1..=50 in UI.
    #[serde(default = "default_max_queue_size")]
    pub max_queue_size: u32,
    /// Persist unfinished queue items in localStorage across panel sessions.
    #[serde(default = "default_true")]
    pub persist_queue: bool,
    /// When true, all items share the panel command; when false, each item may override.
    #[serde(default = "default_true")]
    pub unified_command: bool,
}

impl Default for QueueSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            default_command_id: default_queue_command_id(),
            auto_start_on_enqueue: true,
            max_queue_size: default_max_queue_size(),
            persist_queue: true,
            unified_command: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Root settings document
// ---------------------------------------------------------------------------

/// Application settings persisted as JSON under the app data directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub provider: LlmProvider,
    /// Base URL including `/v1` when using OpenAI-compatible servers.
    pub base_url: String,
    pub model: String,
    pub timeout_secs: u64,
    /// Global shortcut in `ctrl+shift+space` form (lowercase, `+` separated modifiers/key).
    pub global_shortcut: String,
    /// Global shortcut to paste the last pending AI result into the previously focused app.
    #[serde(default = "default_inject_shortcut")]
    pub inject_global_shortcut: String,
    /// Whether to register the global shortcut that auto-pastes the AI result.
    #[serde(default)]
    pub auto_inject_enabled: bool,
    /// How the floating panel behaves on the z-order.
    #[serde(default)]
    pub panel_zorder_mode: PanelZorderMode,
    /// Optional OpenRouter attribution headers (recommended by OpenRouter).
    pub openrouter_site_url: Option<String>,
    pub openrouter_app_name: Option<String>,
    /// Model competition (default off). Only runs when `competition.enabled`.
    #[serde(default)]
    pub competition: CompetitionSettings,
    /// Dedicated translation API routing for translate_* commands.
    #[serde(default)]
    pub translation: TranslationSettings,
    /// AI panel processing queue defaults.
    #[serde(default)]
    pub queue: QueueSettings,
    /// Launch this app automatically when the OS starts (default: on).
    #[serde(default = "default_true")]
    pub autostart_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            provider: LlmProvider::LmStudio,
            base_url: "http://127.0.0.1:1234/v1".to_string(),
            model: "local-model".to_string(),
            timeout_secs: 120,
            global_shortcut: "ctrl+shift+space".to_string(),
            inject_global_shortcut: default_inject_shortcut(),
            auto_inject_enabled: false,
            panel_zorder_mode: PanelZorderMode::Default,
            openrouter_site_url: None,
            openrouter_app_name: Some("IME Companion".to_string()),
            competition: CompetitionSettings::default(),
            translation: TranslationSettings::default(),
            queue: QueueSettings::default(),
            // Default on: first install / missing field → register OS login item.
            autostart_enabled: true,
        }
    }
}

impl AppSettings {
    pub fn config_path(app_data: &PathBuf) -> PathBuf {
        app_data.join("settings.json")
    }

    pub fn load(app_data: &PathBuf) -> Self {
        let path = Self::config_path(app_data);
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(s) = serde_json::from_slice::<AppSettings>(&bytes) {
                println!("[config] loaded settings from {:?}", path);
                return s;
            }
        }
        println!("[config] using default settings (no file or parse error)");
        Self::default()
    }

    pub fn save(&self, app_data: &PathBuf) -> anyhow::Result<()> {
        std::fs::create_dir_all(app_data)?;
        let path = Self::config_path(app_data);
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, json)?;
        println!("[config] saved settings to {:?}", path);
        Ok(())
    }

    /// Apply a competition candidate onto the active provider/base_url/model fields.
    pub fn apply_candidate(&mut self, candidate: &CompetitionCandidate) {
        self.provider = candidate.provider.clone();
        self.base_url = candidate.base_url.clone();
        self.model = candidate.model.clone();
        self.competition.active_candidate_id = Some(candidate.id.clone());
        println!(
            "[config] applied competition winner id={} provider={:?} model={}",
            candidate.id, candidate.provider, candidate.model
        );
    }
}
