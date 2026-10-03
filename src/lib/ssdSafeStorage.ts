/**
 * SSD-friendly localStorage helpers: debounce + skip identical payloads + flush on hide.
 * Avoids hammering the disk when queue/history/stats update in rapid succession.
 */

type FlushFn = () => void;

const flushers = new Set<FlushFn>();
let hideListenersBound = false;

/** Register a flusher invoked on pagehide / visibility hidden (once per page). */
function registerFlusher(flush: FlushFn): void {
  flushers.add(flush);
  if (hideListenersBound || typeof window === "undefined") return;
  hideListenersBound = true;

  const runAll = (reason: string) => {
    console.log("[storage] flush-on-hide", { reason, count: flushers.size });
    for (const fn of flushers) {
      try {
        fn();
      } catch (e) {
        console.warn("[storage] flusher failed", e);
      }
    }
  };

  window.addEventListener("pagehide", () => runAll("pagehide"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") runAll("visibility-hidden");
  });
  console.log("[storage] hide flush listeners bound");
}

export interface DebouncedStorageWriter {
  /** Schedule a write; coalesces bursts and skips if payload equals last durable write. */
  schedule(json: string): void;
  /** Flush any pending write immediately (e.g. before unload). */
  flush(): void;
  /** Cancel pending write without flushing. */
  cancel(): void;
  /** Remove the key immediately (clears pending + last-written cache). */
  remove(): void;
  /** Treat `json` as already on disk (after read) so the next identical schedule is a no-op. */
  seed(json: string | null): void;
}

/**
 * Create a debounced writer for one localStorage key.
 * Default delay 1500ms — merges queue status chatter; flush-on-hide covers abrupt exit.
 */
export function createDebouncedStorageWriter(opts: {
  key: string;
  delayMs?: number;
  label?: string;
}): DebouncedStorageWriter {
  const delayMs = opts.delayMs ?? 1500;
  const label = opts.label ?? opts.key;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  let lastWritten: string | null = null;

  const flush = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending == null) return;
    if (pending === lastWritten) {
      console.log("[storage] skip flush (unchanged)", { label });
      pending = null;
      return;
    }
    try {
      localStorage.setItem(opts.key, pending);
      lastWritten = pending;
      console.log("[storage] flushed", { label, bytes: pending.length });
    } catch (e) {
      console.warn("[storage] flush failed", { label, error: e });
    } finally {
      pending = null;
    }
  };

  registerFlusher(flush);

  return {
    schedule(json: string) {
      // Already durable and nothing pending → no disk I/O.
      if (json === lastWritten && pending == null) {
        console.log("[storage] skip schedule (identical to last write)", { label });
        return;
      }
      // Same as already-pending payload → keep the existing timer (no reset thrash).
      if (json === pending && timer != null) {
        console.log("[storage] coalesce identical pending", { label });
        return;
      }
      pending = json;
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, delayMs);
      console.log("[storage] scheduled", { label, delayMs, bytes: json.length });
    },
    flush,
    cancel() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      console.log("[storage] cancelled pending", { label });
    },
    remove() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      lastWritten = null;
      try {
        localStorage.removeItem(opts.key);
        console.log("[storage] removed key", { label });
      } catch (e) {
        console.warn("[storage] remove failed", { label, error: e });
      }
    },
    seed(json: string | null) {
      lastWritten = json;
      console.log("[storage] seeded last-written", { label, bytes: json?.length ?? 0 });
    },
  };
}
