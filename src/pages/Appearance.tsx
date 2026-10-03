import { useCallback, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageIntro } from "../components/settings/PageIntro";
import { useI18n } from "../i18n/context";
import type { Locale } from "../i18n/locale";
import type { Messages } from "../i18n/messages";
import {
  applyWorkspaceThemeToDocument,
  readWorkspaceTheme,
  writeWorkspaceTheme,
  type WorkspaceTheme,
} from "../lib/prefs";
import { checkForUpdates, getAppVersion, getConfiguredReleasesUrl, type UpdateCheckResult } from "../lib/updateCheck";

function broadcastWorkspaceTheme(theme: WorkspaceTheme): void {
  writeWorkspaceTheme(theme);
  applyWorkspaceThemeToDocument(theme);
  window.dispatchEvent(new Event("workspace-theme-changed"));
  console.log("[appearance] workspace theme", theme);
}

function formatUpdate(result: UpdateCheckResult, copy: Messages["appearance"]): string {
  switch (result.kind) {
    case "no_repo":
      return copy.updateNoRepo(result.current);
    case "http_error":
      return copy.updateHttp(result.status);
    case "no_tag":
      return copy.updateNoTag;
    case "network":
      return copy.updateNetwork(result.detail);
    case "ok":
      return result.hasUpdate
        ? copy.updateFound(result.latest, result.current)
        : copy.updateCurrent(result.latest, result.current);
  }
}

function ThemeStage({ tone }: { tone: "dark" | "light" }) {
  return (
    <span className={`atelier-theme-stage atelier-theme-stage--${tone}`} aria-hidden="true">
      <span className="atelier-theme-stage-bar">
        <i />
        <i />
        <i />
      </span>
      <span className="atelier-theme-stage-row">
        <b />
        <span />
      </span>
      <span className="atelier-theme-stage-row">
        <b />
        <span />
      </span>
      <span className="atelier-theme-stage-row">
        <b />
        <span />
      </span>
    </span>
  );
}

export function AppearancePage() {
  const { locale, setLocale, m } = useI18n();
  const copy = m.appearance;
  const [theme, setTheme] = useState<WorkspaceTheme>(() => readWorkspaceTheme());
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const version = getAppVersion();

  const onTheme = useCallback((next: WorkspaceTheme) => {
    setTheme(next);
    broadcastWorkspaceTheme(next);
  }, []);

  const onLocale = useCallback(
    (next: Locale) => {
      setLocale(next);
      console.log("[appearance] ui locale", next);
    },
    [setLocale],
  );

  const onCheckUpdate = useCallback(async () => {
    setUpdateBusy(true);
    setUpdateResult(null);
    try {
      const result = await checkForUpdates();
      setUpdateResult(result);
      console.log("[appearance] update check", result.kind);
      const url = getConfiguredReleasesUrl();
      if (url && result.kind === "ok" && result.hasUpdate) {
        await openUrl(url);
        console.log("[appearance] opened releases", url);
      }
    } catch (error) {
      setUpdateResult({ kind: "network", current: getAppVersion(), detail: String(error) });
      console.warn("[appearance] update check threw", error);
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  return (
    <div className="atelier-about">
      <PageIntro index="08" kicker={copy.kicker} title={copy.title} lede={copy.lede} />

      <section className="atelier-lang">
        <p className="atelier-kicker">
          <em>Aa</em>
          <span>{copy.languageKicker}</span>
        </p>
        <h2>{copy.languageTitle}</h2>
        <p>{copy.languageLede}</p>
        <div className="atelier-lang-grid" role="radiogroup" aria-label={copy.languageLabel}>
          <button
            type="button"
            role="radio"
            aria-checked={locale === "zh"}
            className={`atelier-theme-plate${locale === "zh" ? " is-active" : ""}`}
            onClick={() => onLocale("zh")}
          >
            <span className="atelier-lang-mark">文</span>
            <span className="atelier-theme-copy">
              <strong>{copy.zhName}</strong>
              <span>{copy.zhHint}</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={locale === "en"}
            className={`atelier-theme-plate${locale === "en" ? " is-active" : ""}`}
            onClick={() => onLocale("en")}
          >
            <span className="atelier-lang-mark">En</span>
            <span className="atelier-theme-copy">
              <strong>{copy.enName}</strong>
              <span>{copy.enHint}</span>
            </span>
          </button>
        </div>
      </section>

      <div className="atelier-theme-grid" role="radiogroup" aria-label={copy.themeLabel}>
        <button
          type="button"
          role="radio"
          aria-checked={theme === "dark"}
          className={`atelier-theme-plate${theme === "dark" ? " is-active" : ""}`}
          onClick={() => onTheme("dark")}
        >
          <ThemeStage tone="dark" />
          <span className="atelier-theme-copy">
            <strong>{copy.darkName}</strong>
            <span>{copy.darkHint}</span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={theme === "light"}
          className={`atelier-theme-plate${theme === "light" ? " is-active" : ""}`}
          onClick={() => onTheme("light")}
        >
          <ThemeStage tone="light" />
          <span className="atelier-theme-copy">
            <strong>{copy.lightName}</strong>
            <span>{copy.lightHint}</span>
          </span>
        </button>
      </div>

      <section className="atelier-about-plate">
        <p className="atelier-kicker">
          <em>v{version}</em>
          <span>{copy.aboutKicker}</span>
        </p>
        <h2>IME Companion</h2>
        <p>{copy.aboutBody}</p>
        <div className="atelier-about-actions">
          <button type="button" className="btn primary" disabled={updateBusy} onClick={() => void onCheckUpdate()}>
            {updateBusy ? copy.checking : copy.checkUpdate}
          </button>
          {updateResult ? <p role="status">{formatUpdate(updateResult, copy)}</p> : null}
        </div>
      </section>
    </div>
  );
}
