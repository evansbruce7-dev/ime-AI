/**
 * UI language persisted in localStorage so the settings window and the floating
 * panel (separate webviews) share one choice. Rust tray labels are updated
 * separately via `set_ui_locale`.
 */

import { invoke } from "@tauri-apps/api/core";

export type Locale = "zh" | "en";

const NS = "ime-ai-companion";

/** localStorage key. Other windows hear changes through the `storage` event. */
export const UI_LOCALE_KEY = `${NS}:ui_locale`;

export function readUiLocale(): Locale {
  try {
    return localStorage.getItem(UI_LOCALE_KEY) === "en" ? "en" : "zh";
  } catch (error) {
    console.warn("[i18n] read locale failed", error);
    return "zh";
  }
}

export function writeUiLocale(locale: Locale): void {
  try {
    localStorage.setItem(UI_LOCALE_KEY, locale);
    console.log("[i18n] stored locale", locale);
  } catch (error) {
    console.warn("[i18n] store locale failed", error);
  }
}

/** Keep `<html lang>` aligned with the active catalog for screen readers. */
export function applyLocaleToDocument(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  console.log("[i18n] document lang", document.documentElement.lang);
}

function inTauriWebview(): boolean {
  if (typeof window === "undefined") return false;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return Boolean(internals?.invoke);
}

/** Push the choice to the tray menu and native window titles. No-op in a plain browser. */
export async function syncNativeLocale(locale: Locale): Promise<void> {
  if (!inTauriWebview()) {
    console.log("[i18n] skip native locale sync (not a Tauri webview)");
    return;
  }
  try {
    await invoke("set_ui_locale", { locale });
    console.log("[i18n] native locale synced", locale);
  } catch (error) {
    console.warn("[i18n] native locale sync failed", error);
  }
}
