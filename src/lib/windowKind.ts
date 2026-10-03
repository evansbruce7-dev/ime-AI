import { getCurrentWindow } from "@tauri-apps/api/window";

/** True when this bundle runs inside the floating `panel` Tauri webview (not `main`, not plain browser). */
export function isPanelWebview(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } };
  if (!w.__TAURI_INTERNALS__?.invoke) return false;
  try {
    return getCurrentWindow().label === "panel";
  } catch {
    return false;
  }
}
