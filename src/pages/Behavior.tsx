import { useCallback, useEffect, useState } from "react";
import { getSettings, saveSettings, type AppSettings } from "../api";
import { EliteSwitch } from "../components/settings/EliteSwitch";
import { PageIntro } from "../components/settings/PageIntro";
import { useI18n } from "../i18n/context";
import { formatShownError } from "../lib/llmErrors";
import { readTrayHintDismissed, writeTrayHintDismissed } from "../lib/prefs";

/**
 * Global shortcut configuration and tray behavior disclosure.
 */
export function BehaviorPage() {
  const { locale, m } = useI18n();
  const copy = m.behavior;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<null | "shortcut" | "autostart-on" | "autostart-off">(null);
  const [trayDismissed, setTrayDismissed] = useState(readTrayHintDismissed);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const s = await getSettings();
      setSettings(s);
      console.log("[behavior] loaded settings");
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveShortcut = async () => {
    if (!settings) return;
    setErr(null);
    setNotice(null);
    try {
      await saveSettings(settings);
      setNotice("shortcut");
      console.log("[behavior] shortcut saved");
    } catch (e) {
      setErr(String(e));
    }
  };

  const dismissTray = () => {
    writeTrayHintDismissed();
    setTrayDismissed(true);
  };

  /** Toggle OS login-item registration; preference is persisted via save_settings (Rust syncs registry). */
  const setAutostart = async (enabled: boolean) => {
    if (!settings) return;
    setErr(null);
    setNotice(null);
    const next = { ...settings, autostart_enabled: enabled };
    setSettings(next);
    try {
      await saveSettings(next);
      setNotice(enabled ? "autostart-on" : "autostart-off");
      console.log("[behavior] autostart_enabled →", enabled);
    } catch (e) {
      setErr(String(e));
      console.error("[behavior] autostart save failed:", e);
      // Revert optimistic UI if persistence / OS sync failed.
      setSettings(settings);
    }
  };

  if (!settings) {
    return (
      <div className="workspace-loading" aria-busy="true">
        <p className="muted">{err ? formatShownError(err, locale) : m.common.loadingSettings}</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <PageIntro index="06" kicker={copy.kicker} title={copy.title} lede={copy.lede} />

      {notice ? (
        <div className="win11-infobar win11-infobar--success" role="status">
          <div className="win11-infobar-body">
            <p>
              {notice === "shortcut" ? copy.savedShortcut : notice === "autostart-on" ? copy.autostartOn : copy.autostartOff}
            </p>
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

      {!trayDismissed ? (
        <div className="win11-infobar win11-infobar--info" role="status">
          <div className="win11-infobar-body">
            <strong>{copy.trayTitle}</strong>
            <p>{copy.trayBody}</p>
          </div>
          <button type="button" className="btn small secondary" onClick={dismissTray}>
            {copy.trayDismiss}
          </button>
        </div>
      ) : null}

      <section className="card settings-card fluent-surface" aria-labelledby="behavior-shortcuts-heading">
        <h2 id="behavior-shortcuts-heading">{copy.shortcuts}</h2>
        <div className="fluent-rows">
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.openPanel}</span>
              <span className="fluent-row-desc">
                {copy.openPanelHint} <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd>
              </span>
            </div>
            <div className="fluent-row-control">
              <input
                aria-label={copy.openPanelAria}
                value={settings.global_shortcut}
                onChange={(e) => setSettings({ ...settings, global_shortcut: e.target.value.trim() })}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.injectToggle}</span>
              <span className="fluent-row-desc">{copy.injectToggleHint}</span>
            </div>
            <div className="fluent-row-control">
              <div className="atelier-switch-line">
                <EliteSwitch
                  label={copy.injectToggle}
                  checked={settings.auto_inject_enabled}
                  onCheckedChange={(enabled) => setSettings({ ...settings, auto_inject_enabled: enabled })}
                />
              </div>
            </div>
          </div>
          {settings.auto_inject_enabled ? (
            <div className="fluent-row">
              <div className="fluent-row-text">
                <span className="fluent-row-label">{copy.inject}</span>
                <span className="fluent-row-desc">
                  {copy.injectHint} <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>
                </span>
              </div>
              <div className="fluent-row-control">
                <input
                  aria-label={copy.injectAria}
                  value={settings.inject_global_shortcut}
                  onChange={(e) => setSettings({ ...settings, inject_global_shortcut: e.target.value.trim() })}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}
        </div>
        <p className="fluent-surface-hint muted small">
          {settings.auto_inject_enabled ? copy.injectOnHint : copy.injectOffHint}
        </p>
        <div className="fluent-surface-actions">
          <button type="button" className="btn primary" onClick={() => void saveShortcut()}>
            {copy.save}
          </button>
        </div>
      </section>

      <section className="card settings-card fluent-surface" aria-labelledby="behavior-autostart-heading">
        <h2 id="behavior-autostart-heading">{copy.startup}</h2>
        <div className="fluent-rows">
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.autostart}</span>
              <span className="fluent-row-desc">{copy.autostartHint}</span>
            </div>
            <div className="fluent-row-control">
              <div className="atelier-switch-line">
                <EliteSwitch
                  label={copy.autostart}
                  checked={settings.autostart_enabled}
                  onCheckedChange={(enabled) => void setAutostart(enabled)}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card settings-card fluent-surface" aria-labelledby="behavior-zorder-heading">
        <h2 id="behavior-zorder-heading">{copy.zorder}</h2>
        <p className="fluent-surface-hint muted small">
          {copy.zorderHint}
          <strong>
            {settings.panel_zorder_mode === "default"
              ? ` ${m.zorder.default}`
              : settings.panel_zorder_mode === "upper"
                ? ` ${m.zorder.upper}`
                : ` ${m.zorder.alwaysTop}`}
          </strong>
          {copy.zorderHintTail}
        </p>
      </section>
    </div>
  );
}
