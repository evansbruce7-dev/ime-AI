/**
 * Map raw upstream / transport error strings to a short title in the active UI language.
 */

import type { Locale } from "../i18n/locale";
import { catalogs } from "../i18n/messages";
import { presentRuntimeText } from "../i18n/present";

export type LlmErrorKind = "timeout" | "unauthorized" | "network" | "bad_url" | "unknown";

export interface ClassifiedLlmError {
  kind: LlmErrorKind;
  title: string;
  detail: string;
}

export function classifyUpstreamError(message: string, locale: Locale): ClassifiedLlmError {
  const copy = catalogs[locale].errors;
  const m = message.toLowerCase();
  if (m.includes("timed out") || m.includes("timeout") || m.includes("deadline")) {
    return { kind: "timeout", title: copy.timeout, detail: message };
  }
  if (m.includes("401") || m.includes("403") || m.includes("unauthorized")) {
    return { kind: "unauthorized", title: copy.unauthorized, detail: message };
  }
  if (
    m.includes("connection refused") ||
    m.includes("failed to connect") ||
    m.includes("dns") ||
    m.includes("network") ||
    m.includes("error sending request")
  ) {
    return { kind: "network", title: copy.network, detail: message };
  }
  if (m.includes("invalid url") || m.includes("relative url without a base")) {
    return { kind: "bad_url", title: copy.badUrl, detail: message };
  }
  return { kind: "unknown", title: copy.failed, detail: message };
}

/** Title plus detail when the failure is a transport class; otherwise the localized raw text. */
export function formatShownError(raw: string, locale: Locale): string {
  const classified = classifyUpstreamError(raw, locale);
  const translated = presentRuntimeText(raw, locale);
  if (classified.kind === "unknown" || translated !== raw) {
    return translated;
  }
  return `${classified.title}${catalogs[locale].models.errorJoin}${raw}`;
}
