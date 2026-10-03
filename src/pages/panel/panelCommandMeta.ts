import type { AppSettings, PromptCommand } from "../../api";
import type { Locale } from "../../i18n/locale";
import { catalogs } from "../../i18n/messages";
import { llmProviderLabel } from "../../i18n/providerLabels";
import type { MenuStylePreset } from "../../lib/prefs";

/** Pretty-print shortcut string from settings (e.g. ctrl+shift+space → Ctrl+Shift+Space). */
export function shortcutDisplayLabel(raw: string | undefined, fallback: string): string {
  const s = (raw ?? fallback).trim().toLowerCase();
  return s
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (p === "space") return "Space";
      if (p.length === 1) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join("+");
}

/** AI 面板提供方徽标：`提供方 • 模型 id`（与「模型」页当前 provider 一致）。 */
export function formatProviderChip(settings: AppSettings, locale: Locale): string {
  const dot = "\u2022";
  const m = settings.model.trim();
  // When competition is on and an active candidate exists, prefer its label.
  if (settings.competition?.enabled && settings.competition.active_candidate_id) {
    const active = settings.competition.candidates.find(
      (c) => c.id === settings.competition.active_candidate_id,
    );
    if (active) {
      return `${active.label} ${dot} ${active.model.trim() || m || "—"}`;
    }
  }
  const label = llmProviderLabel(settings.provider, locale);
  // Strip parenthetical notes for a compact chip.
  const short = label.replace(/（.*?）/g, "").replace(/\(.*?\)/g, "").trim();
  return `${short} ${dot} ${m || "—"}`;
}

/** Competition candidates shown as tags in the AI panel model area. */
export function competitionPanelTags(settings: AppSettings): Array<{
  id: string;
  label: string;
  model: string;
  active: boolean;
  enabled: boolean;
}> {
  if (!settings.competition?.enabled) return [];
  return settings.competition.candidates.map((c) => ({
    id: c.id,
    label: c.label,
    model: c.model,
    active: settings.competition.active_candidate_id === c.id,
    enabled: c.enabled,
  }));
}

export const STYLE_PRESET_ORDER: MenuStylePreset[] = ["graphite", "frost", "ink"];

const BUILTIN_IDS = ["translate_zh", "translate_en", "polish", "summarize", "expand", "correct"] as const;
type BuiltinId = (typeof BUILTIN_IDS)[number];

function isBuiltinId(id: string): id is BuiltinId {
  return (BUILTIN_IDS as readonly string[]).includes(id);
}

/** User-saved titles like「翻译为西语」shown in English as a short chip plus a full name. */
const TRANSLATE_TO_EN: Record<string, { chip: string; title: string; into: string }> = {
  西语: { chip: "To ES", title: "Translate to Spanish", into: "Spanish" },
  西班牙语: { chip: "To ES", title: "Translate to Spanish", into: "Spanish" },
  日语: { chip: "To JA", title: "Translate to Japanese", into: "Japanese" },
  日文: { chip: "To JA", title: "Translate to Japanese", into: "Japanese" },
  法语: { chip: "To FR", title: "Translate to French", into: "French" },
  法文: { chip: "To FR", title: "Translate to French", into: "French" },
  德语: { chip: "To DE", title: "Translate to German", into: "German" },
  德文: { chip: "To DE", title: "Translate to German", into: "German" },
  韩语: { chip: "To KO", title: "Translate to Korean", into: "Korean" },
  韩文: { chip: "To KO", title: "Translate to Korean", into: "Korean" },
  俄语: { chip: "To RU", title: "Translate to Russian", into: "Russian" },
  俄文: { chip: "To RU", title: "Translate to Russian", into: "Russian" },
  葡语: { chip: "To PT", title: "Translate to Portuguese", into: "Portuguese" },
  葡萄牙语: { chip: "To PT", title: "Translate to Portuguese", into: "Portuguese" },
  意大利语: { chip: "To IT", title: "Translate to Italian", into: "Italian" },
  阿拉伯语: { chip: "To AR", title: "Translate to Arabic", into: "Arabic" },
  泰语: { chip: "To TH", title: "Translate to Thai", into: "Thai" },
  越南语: { chip: "To VI", title: "Translate to Vietnamese", into: "Vietnamese" },
};

function translateToEnglish(title: string): { chip: string; title: string; into: string } | null {
  const target = title.trim().match(/^翻译为(.+)$/)?.[1]?.trim();
  if (!target) return null;
  return TRANSLATE_TO_EN[target] ?? null;
}

/** Show the localized title. Built-ins use the catalog;「翻译为西语」becomes “Translate to Spanish” in English. */
export function visibleCommandTitle(id: string, title: string, locale: Locale): string {
  const trimmed = title.trim();
  if (locale === "en") {
    const translated = translateToEnglish(trimmed);
    if (translated) return translated.title;
  }
  if (!isBuiltinId(id)) return title;
  const copy = catalogs[locale].commands.titles[id];
  const known = new Set<string>([catalogs.zh.commands.titles[id], catalogs.en.commands.titles[id]]);
  if (!trimmed || known.has(trimmed)) return copy;
  return title;
}

export function stylePresetLabel(preset: MenuStylePreset, locale: Locale): string {
  return catalogs[locale].commands.styles[preset];
}

/**
 * Chip text. Built-ins use a short catalog label.
 * Custom titles stay readable: words are not glued together, and long names
 * are left for the chip to wrap or ellipsize inside its own cell.
 */
export function getCommandShortLabel(cmd: PromptCommand, locale: Locale): string {
  if (isBuiltinId(cmd.id)) return catalogs[locale].commands.chips[cmd.id];
  const raw = cmd.title.replace(/[（(].*?[)）]/g, "").replace(/\s+/g, " ").trim();
  if (!raw) return catalogs[locale].commands.secondLine;
  if (locale === "en") {
    const translated = translateToEnglish(raw);
    if (translated) return translated.chip;
  }
  return raw;
}

export function getCommandDescription(cmd: PromptCommand | undefined, locale: Locale): string {
  const copy = catalogs[locale].commands;
  if (!cmd) return copy.chooseFirst;
  if (isBuiltinId(cmd.id)) return copy.descriptions[cmd.id];
  if (locale === "en") {
    const translated = translateToEnglish(cmd.title);
    if (translated) return `Translate into ${translated.into} and output only the translation.`;
  }
  const firstLine = cmd.prompt.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return firstLine.replace(/\{\{.*?\}\}/g, copy.contentToken) || copy.custom;
}

export function getNextStylePreset(current: MenuStylePreset): MenuStylePreset {
  const currentIndex = STYLE_PRESET_ORDER.indexOf(current);
  return STYLE_PRESET_ORDER[(currentIndex + 1) % STYLE_PRESET_ORDER.length];
}
