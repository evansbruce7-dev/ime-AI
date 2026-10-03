import { useCallback, useEffect, useState } from "react";
import { PageIntro } from "../components/settings/PageIntro";
import { useI18n } from "../i18n/context";
import { readUsageStats, USAGE_STATS_STORAGE_KEY, type ProviderUsage, type UsageStats } from "../lib/stats";

function MetricCard({ title, data, copy }: { title: string; data: ProviderUsage; copy: { successRate: string; requests: string; successes: string; failures: string } }) {
  const rate = data.requests > 0 ? Math.round((data.successes / data.requests) * 100) : null;
  return (
    <article className="atelier-metric">
      <p className="atelier-kicker">
        <em>{rate === null ? "—" : `${rate}%`}</em>
        <span>{copy.successRate}</span>
      </p>
      <h2>{title}</h2>
      <p className="atelier-metric-rate">{(data.tokens_total ?? 0).toLocaleString()}</p>
      <ul>
        <li>
          <span>{copy.requests}</span>
          <strong>{data.requests}</strong>
        </li>
        <li>
          <span>{copy.successes}</span>
          <strong>{data.successes}</strong>
        </li>
        <li>
          <span>{copy.failures}</span>
          <strong>{data.failures}</strong>
        </li>
      </ul>
    </article>
  );
}

export function StatisticsPage() {
  const { m } = useI18n();
  const copy = m.stats;
  const [stats, setStats] = useState<UsageStats | null>(null);

  const reload = useCallback(() => {
    const next = readUsageStats();
    setStats(next);
    console.log("[statistics] reload", next);
  }, []);

  useEffect(() => {
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === USAGE_STATS_STORAGE_KEY || event.key === null) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reload]);

  if (!stats) {
    return (
      <div className="workspace-loading" aria-busy="true">
        <p className="muted">{m.common.loadingStats}</p>
      </div>
    );
  }

  return (
    <div className="atelier-ledger">
      <PageIntro index="02" kicker={copy.kicker} title={copy.title} lede={copy.lede} />
      <div className="atelier-about-actions">
        <button type="button" className="btn secondary" onClick={() => reload()}>
          {copy.refresh}
        </button>
      </div>
      <div className="atelier-ledger-grid">
        <MetricCard title={copy.lmStudio} data={stats.lm_studio} copy={copy} />
        <MetricCard title={copy.openRouter} data={stats.open_router} copy={copy} />
        <MetricCard title={copy.cloud} data={stats.cloud} copy={copy} />
        <MetricCard title={copy.custom} data={stats.custom} copy={copy} />
      </div>
    </div>
  );
}
