import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSettings, getApiKeyStatus, listCommands, testLlmConnection } from "../api";
import type { AppSettings } from "../api";
import { PageIntro } from "../components/settings/PageIntro";
import { useI18n } from "../i18n/context";
import { llmProviderLabel, translationProviderLabel } from "../i18n/providerLabels";
import { formatShownError } from "../lib/llmErrors";

/**
 * Dashboard: balanced Fluent-style tiles + quick actions (Windows 11 Settings–like density).
 */
export function HomePage() {
  const { locale, m } = useI18n();
  const copy = m.home;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [keyOk, setKeyOk] = useState<boolean | null>(null);
  const [cmdCount, setCmdCount] = useState<number | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, ks, cmds] = await Promise.all([getSettings(), getApiKeyStatus(), listCommands()]);
      setSettings(s);
      setKeyOk(ks.configured);
      setCmdCount(cmds.length);
      console.log("[home] loaded settings provider=", s.provider, "commands=", cmds.length);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const quickTest = async () => {
    setErr(null);
    setTestOk(null);
    try {
      await testLlmConnection();
      setTestOk(true);
      console.log("[home] quick test OK");
    } catch (e) {
      setTestOk(false);
      setErr(String(e));
    }
  };

  if (!settings) {
    return (
      <div className="workspace-loading" aria-busy="true">
        <p className="muted">{err ?? m.common.loadingWorkspace}</p>
      </div>
    );
  }

  const providerLabel = llmProviderLabel(settings.provider, locale);
  const enabledCandidates = settings.competition?.candidates.filter((c) => c.enabled).length ?? 0;
  const competitionHint = settings.competition?.enabled
    ? copy.competitionOn(enabledCandidates)
    : copy.competitionOff;
  const translationHint =
    settings.translation?.provider && settings.translation.provider !== "llm"
      ? copy.translationOn(translationProviderLabel(settings.translation.provider, locale))
      : "";

  return (
    <div className="atelier-home">
      <PageIntro index="01" kicker={copy.kicker} title={copy.title} lede={copy.lede} />

      {err ? (
        <div className="win11-infobar win11-infobar--error" role="alert">
          <div className="win11-infobar-body">
            <p>{formatShownError(err, locale)}</p>
          </div>
        </div>
      ) : null}

      <section className="atelier-hero" aria-label={copy.heroLabel}>
        <div className="atelier-hero-copy">
          <p className="atelier-kicker">
            <em>Live</em>
            <span>{copy.endpoint}</span>
          </p>
          <h2>{providerLabel}</h2>
          <p className="atelier-hero-model">{settings.model}</p>
          <code>{settings.base_url}</code>
          <p className="atelier-hero-meta">
            {competitionHint}
            {translationHint}
          </p>
        </div>
        <div className="atelier-hero-aside">
          <div className={`atelier-pill${keyOk ? " is-on" : ""}`}>
            <span className="atelier-pill-dot" aria-hidden="true" />
            {keyOk ? copy.keyReady : copy.keyMissing}
          </div>
          <div className={`atelier-pill${testOk === true ? " is-on" : testOk === false ? " is-bad" : ""}`}>
            <span className="atelier-pill-dot" aria-hidden="true" />
            {testOk === null ? copy.testUnknown : testOk ? copy.testOk : copy.testFail}
          </div>
          <div className="atelier-hero-actions">
            <button type="button" className="btn primary" onClick={() => void quickTest()}>
              {copy.testButton}
            </button>
            <Link to="/models" className="btn secondary">
              {copy.openModels}
            </Link>
          </div>
        </div>
      </section>

      <div className="atelier-bento" aria-label={copy.shortcutsLabel}>
        <Link to="/behavior" className="atelier-bento-card">
          <div>
            <p className="atelier-kicker">
              <em>06</em>
              <span>{copy.hotkey}</span>
            </p>
            <h3>{copy.openPanel}</h3>
            <p>{copy.openPanelHint}</p>
          </div>
          <kbd>{settings.global_shortcut}</kbd>
        </Link>
        <Link to="/commands" className="atelier-bento-card">
          <div>
            <p className="atelier-kicker">
              <em>03</em>
              <span>{copy.commands}</span>
            </p>
            <h3>{copy.templates}</h3>
          </div>
          <span className="atelier-stat-num">{cmdCount ?? "—"}</span>
        </Link>
        <Link to="/queue" className="atelier-bento-card">
          <div>
            <p className="atelier-kicker">
              <em>05</em>
              <span>{copy.queue}</span>
            </p>
            <h3>{copy.ordered}</h3>
            <p>{copy.queueHint}</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
