/**
 * Client-side AI processing queue (localStorage persistence).
 * Orchestration lives in Panel.tsx; this module only stores / normalizes items.
 *
 * Disk writes are debounced and de-duplicated (see ssdSafeStorage) so rapid
 * pending→running→done transitions do not hammer the SSD.
 */

import { catalogs } from "../i18n/messages";
import { readUiLocale, type Locale } from "../i18n/locale";
import { createDebouncedStorageWriter } from "./ssdSafeStorage";

const NS = "ime-ai-companion";

/** Persisted queue payload key. */
export const PROCESS_QUEUE_KEY = `${NS}:process_queue_v1`;

/** Debounce window for queue persistence (ms). */
const QUEUE_WRITE_DELAY_MS = 1500;

/** Lifecycle of one queued LLM job. */
export type QueueItemStatus = "pending" | "running" | "done" | "error" | "cancelled";

/** One entry in the panel processing queue. */
export interface QueueItem {
  /** Stable client id. */
  id: string;
  /**
   * Arabic numeral label for this task (1, 2, 3…).
   * Used in the queue list and status UI; not sent to the model.
   */
  seq: number;
  /** User input text for this job (source / 原文). */
  input: string;
  /** Prompt command id used when this item runs. */
  commandId: string;
  /** Snapshot of command title for display. */
  commandTitle?: string | null;
  /** Current status. */
  status: QueueItemStatus;
  /** Final / partial result text when done or cancelled. */
  result?: string;
  /** Error message when status === "error". */
  error?: string;
  /** Unix ms when the item was enqueued. */
  createdAt: number;
}

/** Default history / queue capacity when settings are unavailable. */
export const DEFAULT_QUEUE_MAX = 10;

/** Absolute clamp for queue + history size. */
export const QUEUE_MAX_HARD_LIMIT = 50;

const queueWriter = createDebouncedStorageWriter({
  key: PROCESS_QUEUE_KEY,
  delayMs: QUEUE_WRITE_DELAY_MS,
  label: "process-queue",
});

/** Clamp a max-size setting into the supported range. */
export function clampQueueSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_QUEUE_MAX;
  return Math.min(QUEUE_MAX_HARD_LIMIT, Math.max(1, Math.round(n)));
}

/** Generate a unique queue item id. */
export function newQueueItemId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Next Arabic seq number for a new queue item (max existing + 1, or 1). */
export function nextQueueSeq(items: QueueItem[]): number {
  let max = 0;
  for (const item of items) {
    if (typeof item.seq === "number" && item.seq > max) max = item.seq;
  }
  return max + 1;
}

/** Display label: `1. 原文预览…` */
export function formatQueueItemHeading(seq: number, input: string, previewMax = 48): string {
  const n = Number.isFinite(seq) && seq > 0 ? Math.round(seq) : 0;
  const body = input.trim().replace(/\s+/g, " ");
  const preview =
    !body ? "—" : body.length > previewMax ? `${body.slice(0, previewMax)}…` : body;
  return n > 0 ? `${n}. ${preview}` : preview;
}

/**
 * Split pasted / editor text into isolated source units (queue list rows).
 * At run time, same-command items may be sent in ONE LLM call with Arabic numerals
 * and an isolation preamble — never as unmarked stitched prose.
 *
 * Priority:
 * 1) Arabic-numeral markers (`1.` / `1、` / `1)` / `1．`)
 * 2) Blank-line separated paragraphs
 * 3) Single block (unchanged)
 */
export function splitIntoIsolatedSources(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  // Lookahead split so each chunk starts at an Arabic numeral marker.
  const numberedChunks = text
    .split(/(?:^|\n)(?=\d+[\.．、\)]\s*\S)/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (numberedChunks.length > 1) {
    const stripped = numberedChunks
      .map((chunk) => chunk.replace(/^\d+[\.．、\)]\s*/, "").trim())
      .filter(Boolean);
    if (stripped.length > 1) {
      console.log("[queue] splitIntoIsolatedSources: Arabic numerals", {
        parts: stripped.length,
        lengths: stripped.map((s) => s.length),
      });
      return stripped;
    }
  }

  const paragraphs = text
    .split(/\n[ \t]*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) {
    console.log("[queue] splitIntoIsolatedSources: blank lines", {
      parts: paragraphs.length,
      lengths: paragraphs.map((s) => s.length),
    });
    return paragraphs;
  }

  console.log("[queue] splitIntoIsolatedSources: single unit", { len: text.length });
  return [text];
}

/** Join sources with Arabic numerals for the left pane after a batch finishes. */
export function assembleQueueSources(items: QueueItem[]): string {
  return [...items]
    .filter((x) => x.input.trim())
    .sort((a, b) => a.seq - b.seq)
    .map((x) => `${x.seq}. ${x.input.trim()}`)
    .join("\n\n");
}

/**
 * Join per-item results for the result pane.
 * Each task starts on a new block with an Arabic numeral prefix and a blank line between tasks:
 *
 * 1. result A
 *
 * 2. result B
 */
export function assembleQueueResults(items: QueueItem[]): string {
  const blocks = [...items]
    .filter((x) => x.status === "done" && (x.result ?? "").trim())
    .sort((a, b) => a.seq - b.seq)
    .map((x) => {
      // Strip a leading "N." if the model already numbered the piece, to avoid "1. 1. …".
      const body = (x.result ?? "")
        .trim()
        .replace(new RegExp(`^${x.seq}[\\.．、\\)]\\s*`), "")
        .trim();
      return `${x.seq}. ${body}`;
    });
  // Always separate tasks with a blank line so the result pane is easy to scan.
  const joined = blocks.join("\n\n");
  console.log("[queue] assembleQueueResults", {
    blocks: blocks.length,
    totalLen: joined.length,
    preview: joined.slice(0, 120),
  });
  return joined;
}

/** Numbered task list body (no preamble) for display / prompt embedding. */
export function formatNumberedTaskList(items: Array<{ seq: number; input: string }>): string {
  return [...items]
    .sort((a, b) => a.seq - b.seq)
    .map((x) => `${x.seq}. ${x.input.trim()}`)
    .join("\n\n");
}

/** Strip {{input}} / clipboard / selection placeholders from a command template. */
export function stripCommandPlaceholders(promptTemplate: string): string {
  return promptTemplate
    .replace(/\{\{\s*input\s*\}\}/gi, "")
    .replace(/\{\{\s*clipboard\s*\}\}/gi, "")
    .replace(/\{\{\s*selection\s*\}\}/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * One-shot batch prompt: Arabic numerals + explicit “tasks are independent” rules.
 * Used when multiple same-command queue items are sent in a single LLM call.
 */
export function buildIsolatedBatchPrompt(commandPromptTemplate: string, items: QueueItem[]): string {
  const copy = catalogs[readUiLocale()].batch;
  const taskOp = stripCommandPlaceholders(commandPromptTemplate) || copy.fallbackOp;
  const list = formatNumberedTaskList(items);
  const prompt = [
    copy.intro,
    copy.rules,
    copy.rule1,
    copy.rule2,
    copy.rule3,
    copy.sample1,
    copy.sample2,
    copy.rule4,
    "",
    copy.op(taskOp),
    "",
    copy.list,
    list,
  ].join("\n");
  console.log("[queue] buildIsolatedBatchPrompt", {
    locale: readUiLocale(),
    itemCount: items.length,
    seqs: items.map((i) => i.seq),
    promptChars: prompt.length,
  });
  return prompt;
}

/**
 * Parse model output into seq → body. Supports `1.` / `1、` / `1)` / `1．` markers.
 * Also accepts markers that appear mid-line after whitespace (e.g. `1. a  2. b`).
 */
export function parseNumberedResultBlocks(raw: string): Map<number, string> {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const map = new Map<number, string>();
  if (!text) return map;

  // Start-of-string, newline, or 2+ spaces before a marker (common when model skips newlines).
  const re = /(?:^|\n|\s{2,})(\d+)[\.．、\)]\s*/g;
  const marks: { seq: number; markerStart: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const full = m[0];
    let markerStart = m.index;
    if (full.startsWith("\n") || /^\s{2,}/.test(full)) {
      markerStart = m.index + full.search(/\d/);
    }
    marks.push({
      seq: Number(m[1]),
      markerStart,
      contentStart: m.index + full.length,
    });
  }
  if (marks.length === 0) {
    console.warn("[queue] parseNumberedResultBlocks: no Arabic numeral markers found");
    return map;
  }
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].markerStart : text.length;
    const body = text.slice(cur.contentStart, end).trim();
    if (body) map.set(cur.seq, body);
  }
  console.log("[queue] parseNumberedResultBlocks", {
    keys: [...map.keys()],
    count: map.size,
  });
  return map;
}

/** Build a new pending queue item. */
export function createQueueItem(partial: {
  input: string;
  commandId: string;
  commandTitle?: string | null;
  /** Arabic numeral for this task; required for stable list labels. */
  seq: number;
}): QueueItem | null {
  const input = partial.input.trim();
  const commandId = partial.commandId.trim();
  const seq = Math.max(1, Math.round(partial.seq) || 1);
  if (!input || !commandId) {
    console.warn("[queue] createQueueItem rejected empty input or commandId", {
      inputLen: input.length,
      commandId,
    });
    return null;
  }
  const item: QueueItem = {
    id: newQueueItemId(),
    seq,
    input,
    commandId,
    commandTitle: partial.commandTitle ?? null,
    status: "pending",
    createdAt: Date.now(),
  };
  console.log("[queue] created item", {
    id: item.id,
    seq: item.seq,
    inputLen: item.input.length,
    commandId: item.commandId,
  });
  return item;
}

/** Keep at most `max` items (prefer keeping unfinished work at the front). */
export function clampQueue(items: QueueItem[], max: number): QueueItem[] {
  const limit = clampQueueSize(max);
  if (items.length <= limit) return items;
  // Prefer unfinished (pending/running/error) over finished when trimming.
  const unfinished = items.filter((x) => x.status === "pending" || x.status === "running" || x.status === "error");
  const finished = items.filter((x) => x.status === "done" || x.status === "cancelled");
  const merged = [...unfinished, ...finished].slice(0, limit);
  console.log("[queue] clamped", { before: items.length, after: merged.length, limit });
  return merged;
}

/**
 * Snapshot safe to persist: `running` → `pending` so a crash mid-job can resume,
 * and so pending→running alone does not change the durable JSON (skips a write).
 */
export function toDurableQueueSnapshot(items: QueueItem[]): QueueItem[] {
  return items.map((item) =>
    item.status === "running"
      ? {
          ...item,
          status: "pending" as const,
          // Drop in-flight partials from durable store; live UI still holds them in memory.
          result: undefined,
          error: undefined,
        }
      : item,
  );
}

/** Normalize a raw JSON value into a QueueItem, or null if invalid. */
function normalizeQueueItem(raw: unknown): QueueItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.input !== "string" || typeof o.commandId !== "string") {
    return null;
  }
  const statusRaw = typeof o.status === "string" ? o.status : "pending";
  const allowed: QueueItemStatus[] = ["pending", "running", "done", "error", "cancelled"];
  // Stale "running" from a previous session must become pending so the worker can resume.
  let status: QueueItemStatus = allowed.includes(statusRaw as QueueItemStatus)
    ? (statusRaw as QueueItemStatus)
    : "pending";
  if (status === "running") {
    status = "pending";
  }
  return {
    id: o.id,
    seq: typeof o.seq === "number" && o.seq > 0 ? Math.round(o.seq) : 0,
    input: o.input,
    commandId: o.commandId,
    commandTitle: typeof o.commandTitle === "string" ? o.commandTitle : null,
    status,
    result: typeof o.result === "string" ? o.result : undefined,
    error: typeof o.error === "string" ? o.error : undefined,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
  };
}

/** Ensure every item has a positive Arabic seq (backfill by list order). */
export function ensureQueueSeqNumbers(items: QueueItem[]): QueueItem[] {
  let next = 1;
  let changed = false;
  const out = items.map((item) => {
    if (typeof item.seq === "number" && item.seq > 0) {
      if (item.seq >= next) next = item.seq + 1;
      return item;
    }
    changed = true;
    const seq = next;
    next += 1;
    return { ...item, seq };
  });
  if (changed) {
    console.log("[queue] backfilled missing seq numbers", { count: out.length });
  }
  return out;
}

/**
 * Read persisted queue. When `persist` is false, returns [] and does not touch storage.
 * Residual `running` items are remapped to `pending`.
 */
export function readProcessQueue(persist: boolean, max: number): QueueItem[] {
  if (!persist) {
    console.log("[queue] persist disabled — skip read");
    return [];
  }
  try {
    const raw = localStorage.getItem(PROCESS_QUEUE_KEY);
    if (!raw) return [];
    queueWriter.seed(raw);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items = ensureQueueSeqNumbers(
      parsed
        .map(normalizeQueueItem)
        .filter((x): x is QueueItem => x != null),
    );
    const clamped = clampQueue(items, max);
    console.log("[queue] read", { length: clamped.length, max: clampQueueSize(max) });
    return clamped;
  } catch (e) {
    console.warn("[queue] read failed", e);
    return [];
  }
}

/**
 * Schedule a durable queue write (debounced).
 * Pass `immediate: true` only for rare explicit clears / critical checkpoints.
 */
export function writeProcessQueue(
  items: QueueItem[],
  persist: boolean,
  max: number,
  opts?: { immediate?: boolean },
): void {
  try {
    if (!persist) {
      queueWriter.remove();
      console.log("[queue] persist disabled — cleared storage");
      return;
    }
    const next = clampQueue(toDurableQueueSnapshot(items), max);
    const json = JSON.stringify(next);
    if (opts?.immediate) {
      queueWriter.schedule(json);
      queueWriter.flush();
      console.log("[queue] wrote immediately", {
        length: next.length,
        pending: next.filter((x) => x.status === "pending").length,
      });
      return;
    }
    queueWriter.schedule(json);
    console.log("[queue] write scheduled (debounced)", {
      length: next.length,
      pending: next.filter((x) => x.status === "pending").length,
      done: next.filter((x) => x.status === "done").length,
    });
  } catch (e) {
    console.warn("[queue] write failed", e);
  }
}

/** Force any pending queue write to disk now. */
export function flushProcessQueueNow(): void {
  queueWriter.flush();
  console.log("[queue] flushProcessQueueNow");
}

/** Clear persisted queue storage (immediate). */
export function clearProcessQueueStorage(): void {
  queueWriter.remove();
  console.log("[queue] storage cleared");
}

/** Human-readable status label for the panel list, in the active UI language. */
export function queueStatusLabel(status: QueueItemStatus, locale: Locale): string {
  const copy = catalogs[locale].queueStatus;
  switch (status) {
    case "pending":
      return copy.pending;
    case "running":
      return copy.running;
    case "done":
      return copy.done;
    case "error":
      return copy.error;
    case "cancelled":
      return copy.cancelled;
    default:
      return status;
  }
}
