import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getSettings,
  saveSettings,
  setApiKey,
  testLlmConnection,
  LLM_PROVIDER_DEFAULTS,
  type AppSettings,
  type LlmProvider,
} from "../api";
import { CustomTitleBar } from "../components/CustomTitleBar";
import { useI18n } from "../i18n/context";
import { llmProviderLabel } from "../i18n/providerLabels";
import { formatShownError } from "../lib/llmErrors";
import { writeOnboardingComplete } from "../lib/prefs";

const STEPS = 5;
const PROVIDER_OPTIONS = Object.entries(LLM_PROVIDER_DEFAULTS) as [
  LlmProvider,
  (typeof LLM_PROVIDER_DEFAULTS)[LlmProvider],
][];

/**
 * First-run wizard: provider, endpoint, shortcut, tips, finish. Runs in main window only.
 */
export function OnboardingPage() {
  const { locale, m } = useI18n();
  const copy = m.onboarding;
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setErr(null);
    try {
      const s = await getSettings();
      setSettings(s);
      console.log("[onboarding] loaded settings");
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const setProvider = (p: LlmProvider) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const preset = LLM_PROVIDER_DEFAULTS[p];
      const next = { ...prev, provider: p };
      if (preset.baseUrl) next.base_url = preset.baseUrl;
      console.log("[onboarding] provider →", p);
      return next;
    });
  };

  const finish = () => {
    writeOnboardingComplete();
    console.log("[onboarding] complete → /home");
    navigate("/home", { replace: true });
  };

  const skip = () => {
    writeOnboardingComplete();
    navigate("/home", { replace: true });
  };

  const goStep1Next = async () => {
    if (!settings) return;
    setErr(null);
    try {
      await saveSettings(settings);
      setStep(2);
      console.log("[onboarding] step 1 saved");
    } catch (e) {
      setErr(String(e));
    }
  };

  const goStep2Next = async () => {
    if (!settings) return;
    setErr(null);
    setTestMsg(null);
    try {
      await saveSettings(settings);
      const needsKey = LLM_PROVIDER_DEFAULTS[settings.provider].needsKey;
      if (apiKeyInput.trim() && needsKey) {
        await setApiKey(apiKeyInput.trim());
        setApiKeyInput("");
      }
      const r = await testLlmConnection();
      setTestMsg(copy.connected(`${r.slice(0, 160)}${r.length > 160 ? "…" : ""}`));
      setStep(3);
      console.log("[onboarding] step 2 test OK");
    } catch (e) {
      setErr(String(e));
    }
  };

  const goStep3Next = async () => {
    if (!settings) return;
    setErr(null);
    try {
      await saveSettings(settings);
      setStep(4);
    } catch (e) {
      setErr(String(e));
    }
  };

  const needsKey = settings ? LLM_PROVIDER_DEFAULTS[settings.provider].needsKey : false;

  return (
    <main className="workspace-root workspace-win11 app-window-frame" aria-label={copy.windowLabel}>
      <CustomTitleBar
        variant="workspace"
        restoreFloatingPanelAfterClose
        dragContent={
          <div className="workspace-titlebar-inner">
            <span className="workspace-titlebar-heading">{copy.welcome}</span>
          </div>
        }
      />
      <div className="workspace-main" style={{ maxWidth: "42rem", margin: "0 auto" }}>
        <p className="muted" style={{ marginBottom: "1rem" }}>
          {copy.step(step, STEPS)}
        </p>

        {err ? (
          <div className="banner err" role="alert">
            {formatShownError(err, locale)}
          </div>
        ) : null}

        {!settings ? (
          <p className="workspace-loading">{m.common.loadingSettingsShort}</p>
        ) : (
          <div className="onboarding-steps">
            {step === 1 && (
              <div className="onboarding-step">
                <h2>{copy.chooseProvider}</h2>
                <label>
                  {copy.provider}
                  <select value={settings.provider} onChange={(e) => setProvider(e.target.value as LlmProvider)}>
                    {PROVIDER_OPTIONS.map(([id]) => (
                      <option key={id} value={id}>
                        {llmProviderLabel(id, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="onboarding-actions">
                  <button type="button" className="btn secondary" onClick={skip}>
                    {copy.skip}
                  </button>
                  <button type="button" className="btn primary" onClick={() => void goStep1Next()}>
                    {copy.next}
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="onboarding-step">
                <h2>{copy.endpoint}</h2>
                <label>
                  {copy.baseUrl}
                  <input value={settings.base_url} onChange={(e) => setSettings({ ...settings, base_url: e.target.value })} />
                </label>
                <label>
                  {copy.modelId}
                  <input value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })} />
                </label>
                {needsKey && (
                  <label>
                    {copy.apiKey}
                    <input type="password" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} />
                  </label>
                )}
                {testMsg ? <p className="muted small">{testMsg}</p> : null}
                <div className="onboarding-actions">
                  <button type="button" className="btn secondary" onClick={() => setStep(1)}>
                    {copy.back}
                  </button>
                  <button type="button" className="btn primary" onClick={() => void goStep2Next()}>
                    {copy.saveAndTest}
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="onboarding-step">
                <h2>{copy.shortcut}</h2>
                <label>
                  {copy.shortcutField}
                  <input
                    value={settings.global_shortcut}
                    onChange={(e) => setSettings({ ...settings, global_shortcut: e.target.value.trim() })}
                  />
                </label>
                <div className="onboarding-actions">
                  <button type="button" className="btn secondary" onClick={() => setStep(2)}>
                    {copy.back}
                  </button>
                  <button type="button" className="btn primary" onClick={() => void goStep3Next()}>
                    {copy.next}
                  </button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="onboarding-step">
                <h2>{copy.tips}</h2>
                <ul className="muted" style={{ paddingLeft: "1.25rem" }}>
                  <li>{copy.tipTray}</li>
                  <li>{copy.tipPanel}</li>
                </ul>
                <div className="onboarding-actions">
                  <button type="button" className="btn secondary" onClick={() => setStep(3)}>
                    {copy.back}
                  </button>
                  <button type="button" className="btn primary" onClick={() => setStep(5)}>
                    {copy.next}
                  </button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="onboarding-step">
                <h2>{copy.done}</h2>
                <p className="muted">{copy.doneHint}</p>
                <div className="onboarding-actions">
                  <button type="button" className="btn primary" onClick={finish}>
                    {copy.enter}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
