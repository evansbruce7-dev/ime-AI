/**
 * Local usage counters for the Statistics workspace page.
 * Persisted in localStorage; incremented from the AI panel after each LLM run attempt.
 *
 * Writes are debounced and de-duplicated to reduce SSD wear during queue batches.
 */

import type { LlmProvider } from "../api";
import { createDebouncedStorageWriter } from "./ssdSafeStorage";

export const USAGE_STATS_STORAGE_KEY = "ime-ai-companion:usage_stats_v1";
const KEY = USAGE_STATS_STORAGE_KEY;

/** Debounce window for stats persistence (ms). */
const STATS_WRITE_DELAY_MS = 2000;

const statsWriter = createDebouncedStorageWriter({
  key: KEY,
  delayMs: STATS_WRITE_DELAY_MS,
  label: "usage-stats",
});

/** Coarse buckets for the statistics page (cloud providers share one bucket). */
export type ProviderBucket = "lm_studio" | "open_router" | "cloud" | "custom";

export interface ProviderUsage {
  requests: number;
  successes: number;
  failures: number;
  /** Cumulative `usage.total_tokens` from OpenAI-compatible responses. */
  tokens_total: number;
}

export type UsageStats = Record<ProviderBucket, ProviderUsage>;

/** In-memory stats so rapid queue completions coalesce into one disk write. */
let statsMemory: UsageStats | null = null;

const emptyBucket = (): ProviderUsage => ({
  requests: 0,
  successes: 0,
  failures: 0,
  tokens_total: 0,
});

export function defaultUsageStats(): UsageStats {
  return {
    lm_studio: emptyBucket(),
    open_router: emptyBucket(),
    cloud: emptyBucket(),
    custom: emptyBucket(),
  };
}

export function readUsageStats(): UsageStats {
  if (statsMemory) {
    return {
      lm_studio: { ...statsMemory.lm_studio },
      open_router: { ...statsMemory.open_router },
      cloud: { ...statsMemory.cloud },
      custom: { ...statsMemory.custom },
    };
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      statsMemory = defaultUsageStats();
      return defaultUsageStats();
    }
    statsWriter.seed(raw);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      statsMemory = defaultUsageStats();
      return defaultUsageStats();
    }
    const base = defaultUsageStats();
    for (const k of Object.keys(base) as ProviderBucket[]) {
      const b = (parsed as Record<string, unknown>)[k];
      if (!b || typeof b !== "object") continue;
      const o = b as Record<string, unknown>;
      base[k] = {
        requests: typeof o.requests === "number" ? o.requests : 0,
        successes: typeof o.successes === "number" ? o.successes : 0,
        failures: typeof o.failures === "number" ? o.failures : 0,
        tokens_total: typeof o.tokens_total === "number" ? o.tokens_total : 0,
      };
    }
    statsMemory = base;
    return {
      lm_studio: { ...base.lm_studio },
      open_router: { ...base.open_router },
      cloud: { ...base.cloud },
      custom: { ...base.custom },
    };
  } catch {
    statsMemory = defaultUsageStats();
    return defaultUsageStats();
  }
}

function bucketForProvider(p: LlmProvider): ProviderBucket {
  if (p === "lm_studio") return "lm_studio";
  if (p === "open_router") return "open_router";
  if (p === "custom") return "custom";
  return "cloud";
}

/**
 * Record one completed LLM attempt from the panel (success or failure).
 * When `totalTokens` is a positive number from the API `usage` object, it is added to `tokens_total`.
 * Disk write is debounced — a 10-item queue becomes ~1 stats flush instead of 10.
 */
export function recordLlmUsage(provider: LlmProvider, ok: boolean, totalTokens?: number | null): void {
  try {
    const stats = readUsageStats();
    const key = bucketForProvider(provider);
    stats[key].requests += 1;
    if (ok) stats[key].successes += 1;
    else stats[key].failures += 1;
    if (ok && typeof totalTokens === "number" && totalTokens > 0) {
      stats[key].tokens_total += totalTokens;
    }
    statsMemory = stats;
    statsWriter.schedule(JSON.stringify(stats));
    console.log("[stats] recorded (debounced write)", { provider: key, ok, totalTokens, totals: stats[key] });
  } catch (e) {
    console.warn("[stats] failed to persist", e);
  }
}

/** Force pending stats write to disk. */
export function flushUsageStatsNow(): void {
  statsWriter.flush();
  console.log("[stats] flushUsageStatsNow");
}
