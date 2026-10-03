import { useCallback, useEffect, useState } from "react";
import {
  getSettings,
  saveSettings,
  getApiKeyStatus,
  getApiKeyStatusFor,
  setApiKey,
  setApiKeyFor,
  testLlmConnection,
  listLlmModels,
  runCompetitionNow,
  testTranslationConnection,
  newCompetitionCandidate,
  LLM_PROVIDER_DEFAULTS,
  llmSecretSlot,
  translationSecretSlot,
  type AppSettings,
  type LlmProvider,
  type CompetitionCandidate,
  type TranslationProvider,
  type CompetitionEvalResult,
} from "../api";
import { EliteSwitch } from "../components/settings/EliteSwitch";
import { PageIntro } from "../components/settings/PageIntro";
import { useI18n } from "../i18n/context";
import { llmProviderLabel, translationProviderLabel, TRANSLATION_PROVIDER_IDS } from "../i18n/providerLabels";
import { classifyUpstreamError, formatShownError } from "../lib/llmErrors";

const PROVIDER_OPTIONS = Object.entries(LLM_PROVIDER_DEFAULTS) as [
  LlmProvider,
  (typeof LLM_PROVIDER_DEFAULTS)[LlmProvider],
][];

/**
 * Model connection: providers, competition, dedicated translation APIs.
 */
export function ModelsPage() {
  const { locale, m } = useI18n();
  const copy = m.models;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [keyStatus, setKeyStatus] = useState<{ configured: boolean; tail: string | null } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [translationKeyInput, setTranslationKeyInput] = useState("");
  const [translationKeyStatus, setTranslationKeyStatus] = useState<{
    configured: boolean;
    tail: string | null;
  } | null>(null);
  const [testSnippet, setTestSnippet] = useState<string | null>(null);
  const [translationTestOut, setTranslationTestOut] = useState<string | null>(null);
  const [competitionOut, setCompetitionOut] = useState<CompetitionEvalResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [competitionBusy, setCompetitionBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const s = await getSettings();
      setSettings(s);
      const ks = await getApiKeyStatus();
      setKeyStatus(ks);
      if (s.translation.provider !== "llm") {
        const tks = await getApiKeyStatusFor(translationSecretSlot(s.translation.provider));
        setTranslationKeyStatus(tks);
      } else {
        setTranslationKeyStatus(null);
      }
      console.log("[models] loaded provider=", s.provider, "competition=", s.competition.enabled);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setProvider = (p: LlmProvider) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const preset = LLM_PROVIDER_DEFAULTS[p];
      const next = { ...prev, provider: p };
      if (preset.baseUrl) {
        next.base_url = preset.baseUrl;
      }
      console.log("[models] provider switched →", p, "base_url=", next.base_url);
      return next;
    });
    setApiKeyInput("");
  };

  const updateCompetition = (patch: Partial<AppSettings["competition"]>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return { ...prev, competition: { ...prev.competition, ...patch } };
    });
  };

  const updateCandidate = (id: string, patch: Partial<CompetitionCandidate>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const candidates = prev.competition.candidates.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      );
      return { ...prev, competition: { ...prev.competition, candidates } };
    });
  };

  const addCandidate = () => {
    setSettings((prev) => {
      if (!prev) return prev;
      const c = newCompetitionCandidate({
        label: copy.candidateDefault(prev.competition.candidates.length + 1),
        provider: prev.provider,
        base_url: prev.base_url,
        model: prev.model,
      });
      console.log("[models] added competition candidate", c.id);
      return {
        ...prev,
        competition: {
          ...prev.competition,
          candidates: [...prev.competition.candidates, c],
        },
      };
    });
  };

  const removeCandidate = (id: string) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const candidates = prev.competition.candidates.filter((c) => c.id !== id);
      const active =
        prev.competition.active_candidate_id === id
          ? null
          : prev.competition.active_candidate_id;
      console.log("[models] removed competition candidate", id);
      return {
        ...prev,
        competition: { ...prev.competition, candidates, active_candidate_id: active },
      };
    });
  };

  const updateTranslation = (patch: Partial<AppSettings["translation"]>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return { ...prev, translation: { ...prev.translation, ...patch } };
    });
  };

  const save = async () => {
    if (!settings) return;
    setErr(null);
    setSaved(false);
    try {
      await saveSettings(settings);
      if (apiKeyInput.trim()) {
        await setApiKey(apiKeyInput.trim());
        setApiKeyInput("");
        console.log("[models] saved LLM API key for", settings.provider);
      }
      if (translationKeyInput.trim() && settings.translation.provider !== "llm") {
        await setApiKeyFor(
          translationSecretSlot(settings.translation.provider),
          translationKeyInput.trim(),
        );
        setTranslationKeyInput("");
        console.log("[models] saved translation API key for", settings.translation.provider);
      }
      await load();
      setSaved(true);
      console.log("[models] save OK");
    } catch (e) {
      setErr(String(e));
    }
  };

  const runTest = async () => {
    if (!settings) return;
    setErr(null);
    setTestSnippet(null);
    try {
      const needsKey = LLM_PROVIDER_DEFAULTS[settings.provider].needsKey;
      if (needsKey && apiKeyInput.trim()) {
        await setApiKey(apiKeyInput.trim());
        setApiKeyInput("");
        await load();
        console.log("[models] test: saved API key before GET /models");
      }
      const r = await testLlmConnection();
      const snippet = `${r.slice(0, 400)}${r.length > 400 ? "…" : ""}`;
      setTestSnippet(snippet);
      console.log("[models] test OK length=", r.length);
    } catch (e) {
      const raw = String(e);
      const c = classifyUpstreamError(raw, locale);
      setErr(raw);
      console.error("[models] test failed", { kind: c.kind, raw });
    }
  };

  const fetchModelList = async () => {
    setModelsErr(null);
    setModelsBusy(true);
    try {
      const ids = await listLlmModels();
      setModelIds(ids);
      console.log("[models] list_llm_models OK count=", ids.length);
    } catch (e) {
      const raw = String(e);
      const c = classifyUpstreamError(raw, locale);
      setModelsErr(raw);
      console.error("[models] list_llm_models failed", { kind: c.kind, raw });
    } finally {
      setModelsBusy(false);
    }
  };

  const clearKey = async () => {
    setErr(null);
    try {
      await setApiKey("");
      await load();
      console.log("[models] cleared LLM API key");
    } catch (e) {
      setErr(String(e));
    }
  };

  const clearTranslationKey = async () => {
    if (!settings || settings.translation.provider === "llm") return;
    setErr(null);
    try {
      await setApiKeyFor(translationSecretSlot(settings.translation.provider), "");
      await load();
      console.log("[models] cleared translation API key");
    } catch (e) {
      setErr(String(e));
    }
  };

  const runCompetition = async () => {
    if (!settings?.competition.enabled) {
      setErr(copy.competitionRequired);
      return;
    }
    setCompetitionBusy(true);
    setErr(null);
    setCompetitionOut(null);
    try {
      // Persist current candidate edits before probing.
      await saveSettings(settings);
      const result = await runCompetitionNow();
      setCompetitionOut(result);
      await load();
      console.log("[models] competition result", result);
    } catch (e) {
      setErr(String(e));
      console.error("[models] competition failed", e);
    } finally {
      setCompetitionBusy(false);
    }
  };

  const runTranslationTest = async () => {
    if (!settings) return;
    setErr(null);
    setTranslationTestOut(null);
    try {
      if (translationKeyInput.trim() && settings.translation.provider !== "llm") {
        await setApiKeyFor(
          translationSecretSlot(settings.translation.provider),
          translationKeyInput.trim(),
        );
        setTranslationKeyInput("");
      }
      await saveSettings(settings);
      const out = await testTranslationConnection();
      setTranslationTestOut(out);
      console.log("[models] translation test OK", out.slice(0, 80));
    } catch (e) {
      setErr(String(e));
      console.error("[models] translation test failed", e);
    }
  };

  if (!settings) {
    return (
      <div className="workspace-loading" aria-busy="true">
        <p className="muted">{err ? formatShownError(err, locale) : copy.loading}</p>
      </div>
    );
  }

  const providerNeedsKey = LLM_PROVIDER_DEFAULTS[settings.provider].needsKey;
  const translationProvider = settings.translation.provider;

  return (
    <div className="settings-page">
      <PageIntro index="04" kicker={copy.kicker} title={copy.title} lede={copy.lede} />

      {saved ? (
        <div className="win11-infobar win11-infobar--success" role="status">
          <div className="win11-infobar-body">
            <p>{copy.saved}</p>
          </div>
        </div>
      ) : null}
      {err ? (
        <div className="win11-infobar win11-infobar--error" role="alert">
          <div className="win11-infobar-body">
            <p>{formatShownError(err, locale)}</p>
          </div>
        </div>
      ) : null}

      {/* ---------- Primary LLM endpoint ---------- */}
      <section className="card settings-card fluent-surface" aria-labelledby="models-heading">
        <h2 id="models-heading">{copy.endpointHeading}</h2>
        <div className="fluent-rows">
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.provider}</span>
              <span className="fluent-row-desc">{copy.providerHint}</span>
            </div>
            <div className="fluent-row-control">
              <select value={settings.provider} onChange={(e) => setProvider(e.target.value as LlmProvider)}>
                {PROVIDER_OPTIONS.map(([id]) => (
                  <option key={id} value={id}>
                    {llmProviderLabel(id, locale)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.modelId}</span>
              <span className="fluent-row-desc">{copy.modelIdHint}</span>
            </div>
            <div className="fluent-row-control">
              <input
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                list="llm-model-id-list"
                autoComplete="off"
              />
              <datalist id="llm-model-id-list">
                {modelIds.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="fluent-row fluent-row--block">
            <div className="fluent-row-text">
              <span className="fluent-row-label">Base URL</span>
              <span className="fluent-row-desc">
                {copy.baseUrlHintPrefix} <code>/v1</code> {copy.baseUrlHintExample}{" "}
                <code>https://integrate.api.nvidia.com/v1</code>
                {locale === "zh" ? "）" : ")"}
              </span>
            </div>
            <div className="fluent-row-control fluent-row-control--wide">
              <input
                value={settings.base_url}
                onChange={(e) => setSettings({ ...settings, base_url: e.target.value })}
                className="input-grow"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.timeout}</span>
              <span className="fluent-row-desc">{copy.timeoutHint}</span>
            </div>
            <div className="fluent-row-control">
              <input
                type="number"
                min={10}
                value={settings.timeout_secs}
                onChange={(e) => setSettings({ ...settings, timeout_secs: Number(e.target.value) || 120 })}
              />
            </div>
          </div>
          {providerNeedsKey || settings.provider === "custom" ? (
            <div className="fluent-row">
              <div className="fluent-row-text">
                <span className="fluent-row-label">API Key</span>
                <span className="fluent-row-desc">
                  {copy.apiKeyHintPrefix} <code>{llmSecretSlot(settings.provider)}</code>
                  {copy.apiKeyHintSuffix}
                </span>
              </div>
              <div className="fluent-row-control">
                <input
                  type="password"
                  placeholder={keyStatus?.configured ? copy.keySaved(keyStatus.tail ?? "") : "sk-…"}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}
          {settings.provider === "open_router" ? (
            <>
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">HTTP-Referer</span>
                  <span className="fluent-row-desc">{copy.refererHint}</span>
                </div>
                <div className="fluent-row-control">
                  <input
                    value={settings.openrouter_site_url ?? ""}
                    onChange={(e) => setSettings({ ...settings, openrouter_site_url: e.target.value || null })}
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">X-Title</span>
                  <span className="fluent-row-desc">{copy.titleHint}</span>
                </div>
                <div className="fluent-row-control">
                  <input
                    value={settings.openrouter_app_name ?? ""}
                    onChange={(e) => setSettings({ ...settings, openrouter_app_name: e.target.value || null })}
                    autoComplete="off"
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
        <div className="fluent-surface-tools">
          <button type="button" className="btn secondary small" disabled={modelsBusy} onClick={() => void fetchModelList()}>
            {modelsBusy ? copy.fetchingModels : copy.fetchModels}
          </button>
          {modelIds.length ? (
            <span className="muted small settings-action-hint">{copy.loadedModels(modelIds.length)}</span>
          ) : null}
          {providerNeedsKey || settings.provider === "custom" ? (
            <button type="button" className="btn secondary small" onClick={() => void clearKey()}>
              {copy.clearKey}
            </button>
          ) : null}
        </div>
        {modelsErr ? (
          <p className="muted small settings-note" role="alert">
            {modelsErr ? formatShownError(modelsErr, locale) : null}
          </p>
        ) : null}
        <div className="fluent-surface-actions">
          <button type="button" className="btn secondary" onClick={() => void runTest()}>
            {copy.testConnection}
          </button>
        </div>
        {testSnippet ? <pre className="log fluent-surface-log">{copy.testOk(testSnippet)}</pre> : null}
      </section>

      {/* ---------- Model competition ---------- */}
      <section className="card settings-card fluent-surface" aria-labelledby="competition-heading">
        <h2 id="competition-heading">{copy.competition}</h2>
        <p className="muted small settings-note">{copy.competitionNote}</p>
        <div className="fluent-rows">
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.enableCompetition}</span>
              <span className="fluent-row-desc">{copy.enableCompetitionHint}</span>
            </div>
            <div className="fluent-row-control">
              <div className="atelier-switch-line">
                <span className="atelier-switch-caption">
                  {settings.competition.enabled ? m.common.on : m.common.off}
                </span>
                <EliteSwitch
                  label={copy.enableCompetition}
                  checked={settings.competition.enabled}
                  onCheckedChange={(enabled) => {
                    updateCompetition({ enabled });
                    console.log("[models] competition.enabled=", enabled);
                  }}
                />
              </div>
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.probeInterval}</span>
              <span className="fluent-row-desc">{copy.probeIntervalHint}</span>
            </div>
            <div className="fluent-row-control">
              <input
                type="number"
                min={30}
                value={settings.competition.probe_interval_secs}
                onChange={(e) =>
                  updateCompetition({
                    probe_interval_secs: Math.max(30, Number(e.target.value) || 300),
                  })
                }
                disabled={!settings.competition.enabled}
              />
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.weights}</span>
              <span className="fluent-row-desc">{copy.weightsHint}</span>
            </div>
            <div className="fluent-row-control fluent-row-control--weights">
              <input
                type="number"
                step="0.05"
                min={0}
                title={copy.weightLatency}
                value={settings.competition.weight_latency}
                onChange={(e) => updateCompetition({ weight_latency: Number(e.target.value) || 0 })}
                disabled={!settings.competition.enabled}
              />
              <input
                type="number"
                step="0.05"
                min={0}
                title={copy.weightThroughput}
                value={settings.competition.weight_throughput}
                onChange={(e) => updateCompetition({ weight_throughput: Number(e.target.value) || 0 })}
                disabled={!settings.competition.enabled}
              />
              <input
                type="number"
                step="0.05"
                min={0}
                title={copy.weightCost}
                value={settings.competition.weight_cost}
                onChange={(e) => updateCompetition({ weight_cost: Number(e.target.value) || 0 })}
                disabled={!settings.competition.enabled}
              />
            </div>
          </div>
        </div>

        {settings.competition.candidates.map((c) => (
          <div key={c.id} className="competition-candidate fluent-surface" data-candidate-id={c.id}>
            <div className="fluent-rows">
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">{copy.candidateLabel}</span>
                  <span className="fluent-row-desc">{copy.candidateLabelHint}</span>
                </div>
                <div className="fluent-row-control">
                  <input
                    value={c.label}
                    onChange={(e) => updateCandidate(c.id, { label: e.target.value })}
                    disabled={!settings.competition.enabled}
                  />
                </div>
              </div>
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">{copy.join}</span>
                </div>
                <div className="fluent-row-control">
                  <div className="atelier-switch-line">
                    <EliteSwitch
                      label={copy.join}
                      checked={c.enabled}
                      disabled={!settings.competition.enabled}
                      onCheckedChange={(enabled) => updateCandidate(c.id, { enabled })}
                    />
                  </div>
                </div>
              </div>
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">{copy.provider}</span>
                </div>
                <div className="fluent-row-control">
                  <select
                    value={c.provider}
                    disabled={!settings.competition.enabled}
                    onChange={(e) => {
                      const p = e.target.value as LlmProvider;
                      const base = LLM_PROVIDER_DEFAULTS[p].baseUrl || c.base_url;
                      updateCandidate(c.id, { provider: p, base_url: base });
                    }}
                  >
                    {PROVIDER_OPTIONS.map(([id]) => (
                      <option key={id} value={id}>
                        {llmProviderLabel(id, locale)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">{copy.modelId}</span>
                </div>
                <div className="fluent-row-control">
                  <input
                    value={c.model}
                    onChange={(e) => updateCandidate(c.id, { model: e.target.value })}
                    disabled={!settings.competition.enabled}
                  />
                </div>
              </div>
              <div className="fluent-row fluent-row--block">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">Base URL</span>
                </div>
                <div className="fluent-row-control fluent-row-control--wide">
                  <input
                    value={c.base_url}
                    onChange={(e) => updateCandidate(c.id, { base_url: e.target.value })}
                    disabled={!settings.competition.enabled}
                    className="input-grow"
                  />
                </div>
              </div>
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">{copy.cost}</span>
                  <span className="fluent-row-desc">{copy.costHint}</span>
                </div>
                <div className="fluent-row-control">
                  <input
                    type="number"
                    step="0.001"
                    min={0}
                    value={c.cost_per_1k_tokens}
                    onChange={(e) =>
                      updateCandidate(c.id, { cost_per_1k_tokens: Number(e.target.value) || 0 })
                    }
                    disabled={!settings.competition.enabled}
                  />
                </div>
              </div>
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">{copy.manualThroughput}</span>
                  <span className="fluent-row-desc">{copy.manualThroughputHint}</span>
                </div>
                <div className="fluent-row-control">
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    placeholder={
                      c.measured_throughput_tps != null
                        ? copy.measuredPlaceholder(c.measured_throughput_tps.toFixed(1))
                        : copy.auto
                    }
                    value={c.manual_throughput_tps ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      updateCandidate(c.id, {
                        manual_throughput_tps: v === "" ? null : Number(v) || 0,
                      });
                    }}
                    disabled={!settings.competition.enabled}
                  />
                </div>
              </div>
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">{copy.measured}</span>
                  <span className="fluent-row-desc">
                    {copy.latencyWord}{" "}
                    {c.measured_latency_ms != null ? `${c.measured_latency_ms.toFixed(0)} ms` : "—"} · {copy.throughputWord}{" "}
                    {c.measured_throughput_tps != null
                      ? `${c.measured_throughput_tps.toFixed(1)} tok/s`
                      : "—"}
                    {settings.competition.active_candidate_id === c.id ? copy.activeNow : ""}
                  </span>
                </div>
                <div className="fluent-row-control">
                  <button
                    type="button"
                    className="btn secondary small"
                    disabled={!settings.competition.enabled}
                    onClick={() => removeCandidate(c.id)}
                  >
                    {m.common.delete}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

        <div className="fluent-surface-tools">
          <button
            type="button"
            className="btn secondary small"
            disabled={!settings.competition.enabled}
            onClick={addCandidate}
          >
            {copy.addCandidate}
          </button>
          <button
            type="button"
            className="btn secondary small"
            disabled={!settings.competition.enabled || competitionBusy}
            onClick={() => void runCompetition()}
          >
            {competitionBusy ? copy.probing : copy.probeNow}
          </button>
        </div>
        {competitionOut ? (
          <pre className="log fluent-surface-log">
            {`${copy.winner(competitionOut.winner_id ?? m.common.none, competitionOut.applied)}\n`}
            {competitionOut.scores
              .map(
                (s) =>
                  `${s.label}: score=${s.score.toFixed(3)} lat=${s.latency_ms?.toFixed(0) ?? "—"}ms tp=${s.throughput_tps?.toFixed(1) ?? "—"} cost=${s.cost_per_1k}`,
              )
              .join("\n")}
          </pre>
        ) : null}
      </section>

      {/* ---------- Dedicated translation ---------- */}
      <section className="card settings-card fluent-surface" aria-labelledby="translation-heading">
        <h2 id="translation-heading">{copy.translation}</h2>
        <p className="muted small settings-note">{copy.translationNote}</p>
        <div className="fluent-rows">
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.translationProvider}</span>
            </div>
            <div className="fluent-row-control">
              <select
                value={translationProvider}
                onChange={(e) => {
                  const p = e.target.value as TranslationProvider;
                  updateTranslation({ provider: p });
                  setTranslationKeyInput("");
                  console.log("[models] translation provider →", p);
                }}
              >
                {TRANSLATION_PROVIDER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {translationProviderLabel(id, locale)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {translationProvider === "deepl" ? (
            <div className="fluent-row">
              <div className="fluent-row-text">
                <span className="fluent-row-label">DeepL Free API</span>
                <span className="fluent-row-desc">{copy.deeplFreeHint}</span>
              </div>
              <div className="fluent-row-control">
                <div className="atelier-switch-line">
                  <EliteSwitch
                    label="DeepL Free API"
                    checked={settings.translation.deepl_use_free_api}
                    onCheckedChange={(enabled) => updateTranslation({ deepl_use_free_api: enabled })}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {translationProvider === "baidu" ? (
            <div className="fluent-row">
              <div className="fluent-row-text">
                <span className="fluent-row-label">{copy.baiduAppId}</span>
              </div>
              <div className="fluent-row-control">
                <input
                  value={settings.translation.baidu_app_id}
                  onChange={(e) => updateTranslation({ baidu_app_id: e.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}

          {translationProvider === "youdao" ? (
            <div className="fluent-row">
              <div className="fluent-row-text">
                <span className="fluent-row-label">{copy.youdaoAppKey}</span>
              </div>
              <div className="fluent-row-control">
                <input
                  value={settings.translation.youdao_app_key}
                  onChange={(e) => updateTranslation({ youdao_app_key: e.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}

          {translationProvider === "azure" ? (
            <>
              <div className="fluent-row">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">{copy.azureRegion}</span>
                  <span className="fluent-row-desc">{copy.azureRegionHint}</span>
                </div>
                <div className="fluent-row-control">
                  <input
                    value={settings.translation.azure_region}
                    onChange={(e) => updateTranslation({ azure_region: e.target.value })}
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="fluent-row fluent-row--block">
                <div className="fluent-row-text">
                  <span className="fluent-row-label">{copy.azureEndpoint}</span>
                  <span className="fluent-row-desc">{copy.azureEndpointHint}</span>
                </div>
                <div className="fluent-row-control fluent-row-control--wide">
                  <input
                    value={settings.translation.azure_endpoint}
                    onChange={(e) => updateTranslation({ azure_endpoint: e.target.value })}
                    className="input-grow"
                    autoComplete="off"
                  />
                </div>
              </div>
            </>
          ) : null}

          {translationProvider === "google" ? (
            <div className="fluent-row">
              <div className="fluent-row-text">
                <span className="fluent-row-label">Google Project ID</span>
                <span className="fluent-row-desc">{copy.googleProjectHint}</span>
              </div>
              <div className="fluent-row-control">
                <input
                  value={settings.translation.google_project_id}
                  onChange={(e) => updateTranslation({ google_project_id: e.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}

          {translationProvider !== "llm" ? (
            <div className="fluent-row">
              <div className="fluent-row-text">
                <span className="fluent-row-label">{copy.translationKey}</span>
                <span className="fluent-row-desc">
                  {copy.apiKeyHintPrefix} <code>{translationSecretSlot(translationProvider)}</code>
                  {translationProvider === "baidu" || translationProvider === "youdao"
                    ? copy.translationSecretHint
                    : ""}
                </span>
              </div>
              <div className="fluent-row-control">
                <input
                  type="password"
                  placeholder={
                    translationKeyStatus?.configured
                      ? copy.keySaved(translationKeyStatus.tail ?? "")
                      : "API Key / Secret"
                  }
                  value={translationKeyInput}
                  onChange={(e) => setTranslationKeyInput(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}
        </div>
        {translationProvider !== "llm" ? (
          <div className="fluent-surface-tools">
            <button type="button" className="btn secondary small" onClick={() => void runTranslationTest()}>
              {copy.testTranslation}
            </button>
            <button type="button" className="btn secondary small" onClick={() => void clearTranslationKey()}>
              {copy.clearTranslationKey}
            </button>
          </div>
        ) : null}
        {translationTestOut ? <pre className="log fluent-surface-log">{formatShownError(translationTestOut, locale)}</pre> : null}
      </section>

      <div className="footer-actions settings-footer-actions">
        <button type="button" className="btn primary" onClick={() => void save()}>
          {copy.save}
        </button>
      </div>
    </div>
  );
}
