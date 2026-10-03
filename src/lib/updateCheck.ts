/**
 * Optional online version check via GitHub Releases API.
 * Set VITE_GITHUB_REPO at build time to "owner/name" to enable comparison.
 */

declare const __APP_VERSION__: string;

export function getAppVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
}

const repo = typeof import.meta.env.VITE_GITHUB_REPO === "string" ? import.meta.env.VITE_GITHUB_REPO.trim() : "";

function stripLeadingV(tag: string): string {
  return tag.replace(/^v/i, "");
}

/** Compare semantic-ish versions: positive if a > b. */
function compareSemver(a: string, b: string): number {
  const pa = stripLeadingV(a).split(/[.+]/).map((x) => parseInt(x, 10) || 0);
  const pb = stripLeadingV(b).split(/[.+]/).map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export type UpdateCheckResult =
  | { kind: "no_repo"; current: string }
  | { kind: "http_error"; current: string; status: number }
  | { kind: "no_tag"; current: string }
  | { kind: "network"; current: string; detail: string }
  | { kind: "ok"; current: string; latest: string; hasUpdate: boolean; releasesUrl: string };

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const current = getAppVersion();
  if (!repo || !repo.includes("/")) {
    console.log("[update] VITE_GITHUB_REPO not set; skip remote check");
    return { kind: "no_repo", current };
  }
  const releasesUrl = `https://github.com/${repo}/releases`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      console.warn("[update] HTTP", res.status);
      return { kind: "http_error", current, status: res.status };
    }
    const data = (await res.json()) as { tag_name?: string };
    const latest = typeof data.tag_name === "string" ? data.tag_name : "";
    if (!latest) {
      return { kind: "no_tag", current };
    }
    const hasUpdate = compareSemver(stripLeadingV(latest), stripLeadingV(current)) > 0;
    console.log("[update] compare", { current, latest, hasUpdate });
    return { kind: "ok", current, latest, hasUpdate, releasesUrl };
  } catch (e) {
    const detail = String(e);
    console.warn("[update] network", detail);
    return { kind: "network", current, detail };
  }
}

export function getConfiguredReleasesUrl(): string | null {
  if (!repo || !repo.includes("/")) return null;
  return `https://github.com/${repo}/releases`;
}
