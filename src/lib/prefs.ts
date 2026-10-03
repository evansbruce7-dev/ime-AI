/**
 * Client-side preferences stored in localStorage (no Rust changes required).
 * Used for onboarding completion, panel command recents/pins, and UI toggles.
 *
 * Input history writes are debounced (SSD-friendly) with an in-memory cache so
 * reads always see the latest entries before the disk flush.
 */

import { createDebouncedStorageWriter } from "./ssdSafeStorage";

const NS = "ime-ai-companion";

/** Whether the first-run wizard has been completed (user chose to skip or finish). */
export const ONBOARDING_KEY = `${NS}:onboarding_complete`;

/** JSON array of command ids most recently used in the Quick Panel (max 8). */
export const RECENT_CMDS_KEY = `${NS}:recent_commands`;

/** JSON array of command ids pinned in the Quick Panel. */
export const PINNED_CMDS_KEY = `${NS}:pinned_commands`;

/** One-time UI: user dismissed the "close hides to tray" hint in Behavior. */
export const TRAY_HINT_KEY = `${NS}:tray_hint_dismissed`;

export const MENU_STYLE_PRESET_KEY = `${NS}:menu_style_preset`;

/** Workspace window only: light or dark design tokens. */
export const WORKSPACE_THEME_KEY = `${NS}:workspace_theme`;

/** Legacy: plain input strings only (migrated on read). */
export const INPUT_HISTORY_KEY_V1 = `${NS}:input_history_v1`;

/** Panel history entries: submitted input + AI result (and draft-only rescues). */
export const INPUT_HISTORY_KEY = `${NS}:input_history_v2`;

/** Fallback history capacity when caller omits max (aligned with default queue size). */
export const DEFAULT_HISTORY_MAX = 10;

/** Absolute clamp for history size (matches queue hard limit). */
export const HISTORY_MAX_HARD_LIMIT = 50;

/** Debounce window for history persistence (ms). */
const HISTORY_WRITE_DELAY_MS = 1200;

const historyWriter = createDebouncedStorageWriter({
  key: INPUT_HISTORY_KEY,
  delayMs: HISTORY_WRITE_DELAY_MS,
  label: "input-history",
});

/** Clamp history capacity into the supported range. */
export function clampHistoryMax(n: number | undefined | null): number {
  if (n == null || !Number.isFinite(n)) return DEFAULT_HISTORY_MAX;
  return Math.min(HISTORY_MAX_HARD_LIMIT, Math.max(1, Math.round(n)));
}

export type MenuStylePreset = "graphite" | "frost" | "ink";

export type WorkspaceTheme = "dark" | "light";

/** One history row: user input plus optional processing result. */
export interface InputHistoryEntry {
  /** Submitted or rescued draft text. */
  input: string;
  /** AI / translation output; empty for unsubmitted drafts. */
  result: string;
  /** Command id when known (e.g. translate_en). */
  commandId?: string | null;
  /** Command title snapshot for display. */
  commandTitle?: string | null;
  /** Unix ms when the entry was saved. */
  savedAt: number;
}

/** In-memory mirror so UI reads are fresh while disk writes are coalesced. */
let historyMemory: InputHistoryEntry[] | null = null;

export function readOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
    console.log("[prefs] onboarding marked complete");
  } catch (e) {
    console.warn("[prefs] failed to persist onboarding", e);
  }
}

export function readRecentCommandIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_CMDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Push id to front of recents; cap at 8 entries. */
export function pushRecentCommandId(id: string): void {
  if (!id.trim()) return;
  try {
    const prev = readRecentCommandIds();
    const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
    localStorage.setItem(RECENT_CMDS_KEY, JSON.stringify(next));
    console.log("[prefs] recent commands updated", next.length);
  } catch (e) {
    console.warn("[prefs] failed to save recents", e);
  }
}

export function readPinnedCommandIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_CMDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function togglePinnedCommandId(id: string): boolean {
  if (!id.trim()) return false;
  try {
    const prev = readPinnedCommandIds();
    const has = prev.includes(id);
    const next = has ? prev.filter((x) => x !== id) : [...prev, id];
    localStorage.setItem(PINNED_CMDS_KEY, JSON.stringify(next));
    console.log("[prefs] pins toggled", id, !has);
    return !has;
  } catch (e) {
    console.warn("[prefs] failed to toggle pin", e);
    return false;
  }
}

export function readTrayHintDismissed(): boolean {
  try {
    return localStorage.getItem(TRAY_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTrayHintDismissed(): void {
  try {
    localStorage.setItem(TRAY_HINT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function readMenuStylePreset(): MenuStylePreset {
  try {
    const v = localStorage.getItem(MENU_STYLE_PRESET_KEY);
    if (v === "frost" || v === "ink") return v;
    return "graphite";
  } catch {
    return "graphite";
  }
}

export function writeMenuStylePreset(preset: MenuStylePreset): void {
  try {
    localStorage.setItem(MENU_STYLE_PRESET_KEY, preset);
    console.log("[prefs] menu style preset", preset);
  } catch (e) {
    console.warn("[prefs] failed menu style preset", e);
  }
}

export function readWorkspaceTheme(): WorkspaceTheme {
  try {
    return localStorage.getItem(WORKSPACE_THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function writeWorkspaceTheme(theme: WorkspaceTheme): void {
  try {
    localStorage.setItem(WORKSPACE_THEME_KEY, theme);
    console.log("[prefs] workspace theme", theme);
  } catch (e) {
    console.warn("[prefs] workspace theme failed", e);
  }
}

export function applyWorkspaceThemeToDocument(theme: WorkspaceTheme): void {
  document.documentElement.dataset.workspaceTheme = theme;
}

function normalizeHistoryEntry(raw: unknown): InputHistoryEntry | null {
  if (typeof raw === "string") {
    const input = raw.trim();
    if (!input) return null;
    return { input, result: "", commandId: null, commandTitle: null, savedAt: Date.now() };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const input = typeof o.input === "string" ? o.input.trim() : "";
  if (!input) return null;
  const result = typeof o.result === "string" ? o.result.trim() : "";
  return {
    input,
    result,
    commandId: typeof o.commandId === "string" ? o.commandId : null,
    commandTitle: typeof o.commandTitle === "string" ? o.commandTitle : null,
    savedAt: typeof o.savedAt === "number" ? o.savedAt : Date.now(),
  };
}

/** Same input+result pair counts as duplicate (order: most recent first). */
function historyDedupeKey(e: InputHistoryEntry): string {
  return `${e.input}\n---\n${e.result}`;
}

export function readInputHistory(max?: number): InputHistoryEntry[] {
  const limit = clampHistoryMax(max);
  if (historyMemory) {
    return historyMemory.slice(0, limit);
  }
  try {
    const rawV2 = localStorage.getItem(INPUT_HISTORY_KEY);
    if (rawV2) {
      historyWriter.seed(rawV2);
      const parsed = JSON.parse(rawV2) as unknown;
      if (!Array.isArray(parsed)) return [];
      const entries = parsed
        .map(normalizeHistoryEntry)
        .filter((x): x is InputHistoryEntry => x != null);
      historyMemory = entries;
      return entries.slice(0, limit);
    }
    // One-shot migrate legacy string[] history into v2 shape.
    const rawV1 = localStorage.getItem(INPUT_HISTORY_KEY_V1);
    if (!rawV1) return [];
    const parsed = JSON.parse(rawV1) as unknown;
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed
      .map(normalizeHistoryEntry)
      .filter((x): x is InputHistoryEntry => x != null);
    if (migrated.length) {
      historyMemory = migrated;
      const json = JSON.stringify(migrated);
      historyWriter.schedule(json);
      historyWriter.flush();
      console.log("[prefs] migrated input history v1 → v2", migrated.length);
    }
    return migrated.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Remember up to `max` history entries (most recent first).
 * Disk write is debounced; in-memory cache updates immediately for UI.
 * `max` should match settings.queue.max_queue_size so a full queue fits in history.
 */
export function pushInputHistory(
  input: string,
  result?: string | null,
  meta?: { commandId?: string | null; commandTitle?: string | null },
  max?: number,
): void {
  const t = input.trim();
  if (!t) return;
  const limit = clampHistoryMax(max);
  const entry: InputHistoryEntry = {
    input: t,
    result: (result ?? "").trim(),
    commandId: meta?.commandId ?? null,
    commandTitle: meta?.commandTitle ?? null,
    savedAt: Date.now(),
  };
  try {
    const prev = readInputHistory(limit);
    const key = historyDedupeKey(entry);
    const next = [entry, ...prev.filter((x) => historyDedupeKey(x) !== key)].slice(0, limit);
    historyMemory = next;
    historyWriter.schedule(JSON.stringify(next));
    console.log("[prefs] history updated (debounced write)", {
      length: next.length,
      max: limit,
      inputLen: entry.input.length,
      resultLen: entry.result.length,
      commandId: entry.commandId,
    });
  } catch (e) {
    console.warn("[prefs] input history failed", e);
  }
}

/** Force pending history write to disk. */
export function flushInputHistoryNow(): void {
  historyWriter.flush();
  console.log("[prefs] flushInputHistoryNow");
}

/** Preview helpers for the history popover (keep list compact). */
export function historyPreview(text: string, max = 80): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "—";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
