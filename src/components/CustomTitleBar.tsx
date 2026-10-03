import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../i18n/context";

export type TitleBarVariant = "quick" | "workspace" | "toolbar";

type Props = {
  /** Visual density: workspace vs compact toolbar strip vs legacy quick gradient. */
  variant?: TitleBarVariant;
  /** Content placed in the draggable title area. */
  dragContent: ReactNode;
  /**
   * Optional slot before window controls (e.g.「工作区」).
   * If omitted, no empty column or extra divider is rendered (fixes blank titlebar gutter).
   */
  leadingActions?: ReactNode;
  /**
   * When the main window closes via titlebar hide, Rust had hidden the floating `panel` window.
   * Notify backend so the panel can be shown again without blocking the desktop.
   */
  restoreFloatingPanelAfterClose?: boolean;
};

function IconMinimize() {
  return (
    <svg className="titlebar-btn-svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function IconMaximize() {
  return (
    <svg className="titlebar-btn-svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect
        x="4.25"
        y="4.25"
        width="7.5"
        height="7.5"
        rx="1.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function IconClose() {
  return (
    <svg className="titlebar-btn-svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M5 5l6 6M11 5l-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Frameless window chrome: draggable region + optional lead slot + minimize / maximize / close.
 * Close uses `hide()` so tray workflows keep working.
 */
export function CustomTitleBar({
  variant = "workspace",
  dragContent,
  leadingActions,
  restoreFloatingPanelAfterClose = false,
}: Props) {
  const { m } = useI18n();
  const onMinimize = () => {
    void getCurrentWindow().minimize();
  };

  const onToggleMaximize = () => {
    void getCurrentWindow().toggleMaximize();
  };

  const onClose = () => {
    void (async () => {
      await getCurrentWindow().hide();
      if (restoreFloatingPanelAfterClose) {
        try {
          await invoke("workspace_window_hidden_cmd");
          console.log("[ui] workspace_window_hidden_cmd ok — floating panel restored");
        } catch (e) {
          console.warn("[ui] workspace_window_hidden_cmd failed", e);
        }
      }
    })();
  };

  const hasLead = leadingActions != null && leadingActions !== false;

  const barClass = ["custom-titlebar"];
  if (variant === "quick") barClass.push("custom-titlebar--quick");
  if (variant === "toolbar") barClass.push("custom-titlebar--toolbar");
  if (hasLead) barClass.push("custom-titlebar--has-lead");

  const dragClass =
    variant === "toolbar"
      ? "custom-titlebar-drag custom-titlebar-drag--toolbar"
      : "custom-titlebar-drag";

  return (
    <header className={barClass.join(" ")}>
      <div className={dragClass} data-tauri-drag-region>
        {dragContent}
      </div>
      {hasLead ? <div className="custom-titlebar-lead">{leadingActions}</div> : null}
      <div className="custom-titlebar-controls">
        <button type="button" className="titlebar-btn titlebar-btn-min" onClick={onMinimize} aria-label={m.common.minimize} title={m.common.minimize}>
          <IconMinimize />
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn-max"
          onClick={onToggleMaximize}
          aria-label={m.common.maximizeRestore}
          title={m.common.maximize}
        >
          <IconMaximize />
        </button>
        <button type="button" className="titlebar-btn titlebar-btn-close" onClick={onClose} aria-label={m.common.close} title={m.common.close}>
          <IconClose />
        </button>
      </div>
    </header>
  );
}
