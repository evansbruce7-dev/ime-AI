import { useCallback, useEffect, useState } from "react";
import {
  clampQueueMaxSize,
  getSettings,
  peekSettings,
  listCommands,
  saveSettings,
  type AppSettings,
  type PromptCommand,
} from "../api";
import { EliteSwitch } from "../components/settings/EliteSwitch";
import { PageIntro } from "../components/settings/PageIntro";
import { useI18n } from "../i18n/context";
import { formatShownError } from "../lib/llmErrors";
import { visibleCommandTitle } from "./panel/panelCommandMeta";

/**
 * Dedicated settings tab for AI panel processing-queue defaults.
 */
export function QueuePage() {
  const { locale, m } = useI18n();
  const copy = m.queue;
  const [settings, setSettings] = useState<AppSettings | null>(peekSettings);
  const [cmds, setCmds] = useState<PromptCommand[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, list] = await Promise.all([getSettings(), listCommands()]);
      setSettings(s);
      setCmds(list);
      console.log("[queue-settings] loaded", {
        queue: s.queue,
        commandCount: list.length,
      });
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveQueue = async () => {
    if (!settings) return;
    setErr(null);
    setSaved(false);
    try {
      const next: AppSettings = {
        ...settings,
        queue: {
          ...settings.queue,
          max_queue_size: clampQueueMaxSize(settings.queue.max_queue_size),
          default_command_id: settings.queue.default_command_id.trim() || "translate_en",
        },
      };
      setSettings(next);
      await saveSettings(next);
      setSaved(true);
      console.log("[queue-settings] saved", next.queue);
    } catch (e) {
      setErr(String(e));
    }
  };

  if (!settings) {
    return (
      <div className="workspace-loading" aria-busy="true">
        <p className="muted">{err ? formatShownError(err, locale) : m.common.loadingSettings}</p>
      </div>
    );
  }

  const patchQueue = (partial: Partial<AppSettings["queue"]>) => {
    setSettings({
      ...settings,
      queue: { ...settings.queue, ...partial },
    });
  };

  return (
    <div className="settings-page">
      <PageIntro index="05" kicker={copy.kicker} title={copy.title} lede={copy.lede} />

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

      <section className="card settings-card fluent-surface" aria-labelledby="queue-defaults-heading">
        <h2 id="queue-defaults-heading">{copy.defaults}</h2>
        <p className="fluent-surface-hint muted small">{copy.defaultsHint}</p>
        <div className="fluent-rows">
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.enable}</span>
              <span className="fluent-row-desc">
                {copy.enableHint.split("Ctrl+Enter")[0]}
                <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
                {copy.enableHint.split("Ctrl+Enter")[1] ?? ""}
              </span>
            </div>
            <div className="fluent-row-control">
              <div className="atelier-switch-line">
                <EliteSwitch
                  label={copy.enable}
                  checked={settings.queue.enabled}
                  onCheckedChange={(enabled) => patchQueue({ enabled })}
                />
              </div>
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.defaultCommand}</span>
              <span className="fluent-row-desc">{copy.defaultCommandHint}</span>
            </div>
            <div className="fluent-row-control">
              <select
                aria-label={copy.defaultCommandAria}
                value={settings.queue.default_command_id}
                onChange={(e) => patchQueue({ default_command_id: e.target.value })}
              >
                {cmds.length === 0 ? (
                  <option value={settings.queue.default_command_id}>
                    {settings.queue.default_command_id}
                  </option>
                ) : (
                  cmds.map((c) => (
                    <option key={c.id} value={c.id}>
                      {visibleCommandTitle(c.id, c.title, locale)}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.autoStart}</span>
              <span className="fluent-row-desc">{copy.autoStartHint}</span>
            </div>
            <div className="fluent-row-control">
              <div className="atelier-switch-line">
                <EliteSwitch
                  label={copy.autoStart}
                  checked={settings.queue.auto_start_on_enqueue}
                  onCheckedChange={(enabled) => patchQueue({ auto_start_on_enqueue: enabled })}
                />
              </div>
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.max}</span>
              <span className="fluent-row-desc">{copy.maxHint}</span>
            </div>
            <div className="fluent-row-control">
              <input
                type="number"
                min={1}
                max={50}
                aria-label={copy.maxAria}
                value={settings.queue.max_queue_size}
                onChange={(e) =>
                  patchQueue({ max_queue_size: clampQueueMaxSize(Number(e.target.value)) })
                }
              />
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.persist}</span>
              <span className="fluent-row-desc">{copy.persistHint}</span>
            </div>
            <div className="fluent-row-control">
              <div className="atelier-switch-line">
                <EliteSwitch
                  label={copy.persist}
                  checked={settings.queue.persist_queue}
                  onCheckedChange={(enabled) => patchQueue({ persist_queue: enabled })}
                />
              </div>
            </div>
          </div>
          <div className="fluent-row">
            <div className="fluent-row-text">
              <span className="fluent-row-label">{copy.unified}</span>
              <span className="fluent-row-desc">{copy.unifiedHint}</span>
            </div>
            <div className="fluent-row-control">
              <div className="atelier-switch-line">
                <EliteSwitch
                  label={copy.unified}
                  checked={settings.queue.unified_command}
                  onCheckedChange={(enabled) => patchQueue({ unified_command: enabled })}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="fluent-surface-actions">
          <button type="button" className="btn primary" onClick={() => void saveQueue()}>
            {copy.save}
          </button>
        </div>
      </section>
    </div>
  );
}
