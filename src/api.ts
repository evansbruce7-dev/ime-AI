import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { readUiLocale } from "./i18n/locale";
import { catalogs } from "./i18n/messages";

/**
 * Tauri 只在桌面窗口的 WebView 里注入 `window.__TAURI_INTERNALS__.invoke`。
 * 若只用 `npm run dev` 并在浏览器打开 localhost，则没有该对象，会报错。
 */
function assertTauriIpc(): void {
  if (typeof window === "undefined") {
    return;
  }
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } };
  if (!w.__TAURI_INTERNALS__?.invoke) {
    throw new Error(catalogs[readUiLocale()].onboarding.tauriRequired);
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  assertTauriIpc();
  return tauriInvoke<T>(cmd, args);
}

/** OpenAI-compatible LLM provider presets. */
export type LlmProvider =
  | "lm_studio"
  | "open_router"
  | "openai"
  | "nvidia_nim"
  | "deepseek"
  | "groq"
  | "together"
  | "siliconflow"
  | "moonshot"
  | "custom";

export type PanelZorderMode = "default" | "upper" | "always_top";

/** Dedicated translation APIs (non-LLM). */
export type TranslationProvider =
  | "llm"
  | "deepl"
  | "baidu"
  | "youdao"
  | "azure"
  | "google";

/** One model that can compete when competition is enabled. */
export interface CompetitionCandidate {
  id: string;
  label: string;
  provider: LlmProvider;
  base_url: string;
  model: string;
  enabled: boolean;
  /** User-set average cost per 1K tokens (currency-agnostic). */
  cost_per_1k_tokens: number;
  /** Manual throughput override (tokens/sec); null → use measured average. */
  manual_throughput_tps: number | null;
  measured_latency_ms: number | null;
  measured_throughput_tps: number | null;
  last_probe_unix: number | null;
}

export interface CompetitionSettings {
  /** Master switch — default off. Algorithm only runs when true. */
  enabled: boolean;
  /** Auto probe interval in seconds for connection latency. */
  probe_interval_secs: number;
  weight_latency: number;
  weight_throughput: number;
  weight_cost: number;
  candidates: CompetitionCandidate[];
  active_candidate_id: string | null;
}

export interface TranslationSettings {
  provider: TranslationProvider;
  deepl_use_free_api: boolean;
  baidu_app_id: string;
  youdao_app_key: string;
  azure_region: string;
  azure_endpoint: string;
  google_project_id: string;
}

/** Default options for the AI panel processing queue. */
export interface QueueSettings {
  /** Master switch — when false, Ctrl+Enter runs a single job. */
  enabled: boolean;
  /** Default command id for new queue items / panel bootstrap. */
  default_command_id: string;
  /** When true, enqueueing starts / continues the sequential worker. */
  auto_start_on_enqueue: boolean;
  /** Max queue items (also drives history capacity). UI clamps 1..=50. */
  max_queue_size: number;
  /** Persist unfinished queue items across panel sessions. */
  persist_queue: boolean;
  /** When true, all items share the panel command; when false, each may override. */
  unified_command: boolean;
}

export interface AppSettings {
  provider: LlmProvider;
  base_url: string;
  model: string;
  timeout_secs: number;
  global_shortcut: string;
  /** Global shortcut to paste pending AI result into the last external text target. */
  inject_global_shortcut: string;
  /** Whether the global shortcut automatically injects the AI result. */
  auto_inject_enabled: boolean;
  panel_zorder_mode: PanelZorderMode;
  openrouter_site_url: string | null;
  openrouter_app_name: string | null;
  competition: CompetitionSettings;
  translation: TranslationSettings;
  queue: QueueSettings;
  /** Launch at OS login / boot. Defaults to true when missing from older settings.json. */
  autostart_enabled: boolean;
}

export interface PromptCommand {
  id: string;
  title: string;
  prompt: string;
}

export interface ApiKeyStatus {
  configured: boolean;
  tail: string | null;
}

export interface RunResult {
  text: string;
  total_tokens?: number | null;
}

export interface StreamRunResult {
  text: string;
  total_tokens?: number | null;
  cancelled: boolean;
}

export interface CandidateScore {
  id: string;
  label: string;
  score: number;
  latency_ms: number | null;
  throughput_tps: number | null;
  cost_per_1k: number;
  norm_latency: number;
  norm_throughput: number;
  norm_cost: number;
}

export interface CompetitionEvalResult {
  winner_id: string | null;
  scores: CandidateScore[];
  applied: boolean;
}

/** Default base URLs for each LLM provider preset. */
export const LLM_PROVIDER_DEFAULTS: Record<LlmProvider, { label: string; baseUrl: string; needsKey: boolean }> = {
  lm_studio: { label: "LM Studio（本机）", baseUrl: "http://127.0.0.1:1234/v1", needsKey: false },
  open_router: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", needsKey: true },
  nvidia_nim: { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", needsKey: true },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", needsKey: true },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", needsKey: true },
  siliconflow: { label: "SiliconFlow（硅基流动）", baseUrl: "https://api.siliconflow.cn/v1", needsKey: true },
  moonshot: { label: "Moonshot（Kimi）", baseUrl: "https://api.moonshot.cn/v1", needsKey: true },
  custom: { label: "自定义 base URL", baseUrl: "", needsKey: false },
};

export const TRANSLATION_PROVIDER_LABELS: Record<TranslationProvider, string> = {
  llm: "大模型提示词（默认）",
  deepl: "DeepL",
  baidu: "百度翻译",
  youdao: "有道翻译",
  azure: "Azure Translator",
  google: "Google Cloud Translation",
};

/** Secret slot name for an LLM provider (must match Rust `secret_slot`). */
export function llmSecretSlot(provider: LlmProvider): string {
  return provider;
}

/** Secret slot name for a translation provider. */
export function translationSecretSlot(provider: TranslationProvider): string {
  return `translation_${provider === "llm" ? "llm" : provider}`;
}

export function defaultCompetitionSettings(): CompetitionSettings {
  return {
    enabled: false,
    probe_interval_secs: 300,
    weight_latency: 0.35,
    weight_throughput: 0.4,
    weight_cost: 0.25,
    candidates: [],
    active_candidate_id: null,
  };
}

export function defaultTranslationSettings(): TranslationSettings {
  return {
    provider: "llm",
    deepl_use_free_api: true,
    baidu_app_id: "",
    youdao_app_key: "",
    azure_region: "",
    azure_endpoint: "",
    google_project_id: "",
  };
}

/** Clamp queue size to the supported range (1..=50). */
export function clampQueueMaxSize(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.min(50, Math.max(1, Math.round(n)));
}

export function defaultQueueSettings(): QueueSettings {
  return {
    enabled: true,
    default_command_id: "translate_en",
    auto_start_on_enqueue: true,
    max_queue_size: 10,
    persist_queue: true,
    unified_command: true,
  };
}

/** Ensure older settings payloads still have competition/translation/queue objects. */
export function normalizeSettings(s: AppSettings): AppSettings {
  const queueRaw = s.queue ?? defaultQueueSettings();
  const queue: QueueSettings = {
    ...defaultQueueSettings(),
    ...queueRaw,
    max_queue_size: clampQueueMaxSize(queueRaw.max_queue_size ?? 10),
    default_command_id: (queueRaw.default_command_id || "translate_en").trim() || "translate_en",
  };
  return {
    ...s,
    competition: s.competition ?? defaultCompetitionSettings(),
    translation: s.translation ?? defaultTranslationSettings(),
    queue,
    // Older settings.json may omit this field; default ON to match product preference.
    autostart_enabled: s.autostart_enabled ?? true,
  };
}

export function newCompetitionCandidate(partial?: Partial<CompetitionCandidate>): CompetitionCandidate {
  return {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    label: partial?.label ?? "候选模型",
    provider: partial?.provider ?? "lm_studio",
    base_url: partial?.base_url ?? LLM_PROVIDER_DEFAULTS.lm_studio.baseUrl,
    model: partial?.model ?? "local-model",
    enabled: partial?.enabled ?? true,
    cost_per_1k_tokens: partial?.cost_per_1k_tokens ?? 0,
    manual_throughput_tps: partial?.manual_throughput_tps ?? null,
    measured_latency_ms: partial?.measured_latency_ms ?? null,
    measured_throughput_tps: partial?.measured_throughput_tps ?? null,
    last_probe_unix: partial?.last_probe_unix ?? null,
  };
}

/** Last settings read or saved in this webview. Tab switches paint from this instead of a loading blank. */
let settingsCache: AppSettings | null = null;

export function peekSettings(): AppSettings | null {
  return settingsCache;
}

export async function getSettings(): Promise<AppSettings> {
  const s = normalizeSettings(await invoke<AppSettings>("get_settings"));
  settingsCache = s;
  console.log("[settings] cache updated", s.provider, s.model);
  return s;
}

export async function saveSettings(next: AppSettings): Promise<void> {
  const normalized = normalizeSettings(next);
  await invoke("save_settings", { next: normalized });
  settingsCache = normalized;
  console.log("[settings] cache updated after save", normalized.provider, normalized.model);
}

export async function getApiKeyStatus(): Promise<ApiKeyStatus> {
  return invoke<ApiKeyStatus>("get_api_key_status");
}

export async function getApiKeyStatusFor(slot: string): Promise<ApiKeyStatus> {
  return invoke<ApiKeyStatus>("get_api_key_status_for", { slot });
}

export async function setApiKey(key: string): Promise<void> {
  return invoke("set_api_key_cmd", { key });
}

export async function setApiKeyFor(slot: string, key: string): Promise<void> {
  return invoke("set_api_key_for_cmd", { slot, key });
}

export async function listCommands(): Promise<PromptCommand[]> {
  return invoke("list_commands");
}

export async function listDefaultCommands(): Promise<PromptCommand[]> {
  return invoke("list_default_commands");
}

export interface UserCommandsLoad {
  commands: PromptCommand[];
  order: string[];
}

export async function getUserCommands(): Promise<UserCommandsLoad> {
  return invoke("get_user_commands");
}

export async function saveUserCommands(cmds: PromptCommand[], order: string[]): Promise<void> {
  return invoke("save_user_commands_cmd", { cmds, order });
}

export async function runLlm(args: {
  commandId: string | null;
  promptOverride: string | null;
  input: string;
  useClipboard: boolean;
  useSelection: boolean;
}): Promise<RunResult> {
  return invoke("run_llm", {
    commandId: args.commandId,
    promptOverride: args.promptOverride,
    input: args.input,
    useClipboard: args.useClipboard,
    useSelection: args.useSelection,
  });
}

export async function runLlmStream(args: {
  commandId: string | null;
  promptOverride: string | null;
  input: string;
  useClipboard: boolean;
  useSelection: boolean;
}): Promise<StreamRunResult> {
  return invoke("run_llm_stream", {
    commandId: args.commandId,
    promptOverride: args.promptOverride,
    input: args.input,
    useClipboard: args.useClipboard,
    useSelection: args.useSelection,
  });
}

export async function cancelLlmStream(): Promise<void> {
  return invoke("cancel_llm_stream");
}

export async function listLlmModels(): Promise<string[]> {
  return invoke("list_llm_models");
}

export async function testLlmConnection(): Promise<string> {
  return invoke("test_llm_connection");
}

export async function runCompetitionNow(): Promise<CompetitionEvalResult> {
  return invoke("run_competition_now");
}

export async function evaluateCompetition(): Promise<CompetitionEvalResult> {
  return invoke("evaluate_competition");
}

export async function testTranslationConnection(): Promise<string> {
  return invoke("test_translation_connection");
}

export async function setPendingInjectText(text: string): Promise<void> {
  return invoke("set_pending_inject_text", { text });
}

export async function clearPendingInjectText(): Promise<void> {
  return invoke("clear_pending_inject_text");
}

export async function copyToClipboard(text: string): Promise<void> {
  return invoke("copy_to_clipboard_cmd", { text });
}

export async function setPanelZorderMode(mode: PanelZorderMode): Promise<void> {
  return invoke("set_panel_zorder_mode", { mode });
}

export async function showPanelCmd(): Promise<void> {
  return invoke("show_panel_cmd");
}

export async function reportPanelExpandedSize(width: number, height: number): Promise<void> {
  return invoke("report_panel_expanded_size", { width, height });
}

export async function revealPanelFirstPaint(
  width: number,
  height: number,
  devicePixelRatio?: number,
): Promise<void> {
  return invoke("reveal_panel_first_paint", { width, height, devicePixelRatio: devicePixelRatio ?? null });
}

export async function syncPanelWindowGeometry(args: {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  x?: number;
  y?: number;
  cacheExpandedSize?: boolean;
  /** `window.devicePixelRatio`. Rust turns CSS px into physical px with this, not monitor DPI alone. */
  devicePixelRatio?: number;
}): Promise<void> {
  return invoke("sync_panel_window_geometry", {
    width: args.width,
    height: args.height,
    minWidth: args.minWidth ?? null,
    minHeight: args.minHeight ?? null,
    maxWidth: args.maxWidth ?? null,
    maxHeight: args.maxHeight ?? null,
    x: args.x ?? null,
    y: args.y ?? null,
    cacheExpandedSize: args.cacheExpandedSize ?? false,
    devicePixelRatio: args.devicePixelRatio ?? null,
  });
}

export async function showSettingsCmd(): Promise<void> {
  return invoke("show_settings_cmd");
}

export async function showCommandsCmd(): Promise<void> {
  return invoke("show_commands_cmd");
}

export async function showWorkspacePageCmd(slug: string): Promise<void> {
  return invoke("show_workspace_page_cmd", { slug });
}
