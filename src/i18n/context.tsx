import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { applyLocaleToDocument, readUiLocale, syncNativeLocale, writeUiLocale, type Locale } from "./locale";
import { catalogs, type Messages } from "./messages";

type I18nValue = {
  locale: Locale;
  m: Messages;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nValue | null>(null);

function readInitialLocale(): Locale {
  const locale = readUiLocale();
  applyLocaleToDocument(locale);
  return locale;
}

/**
 * Provides the active catalog. A change in one window is written to localStorage;
 * the other window picks it up from the `storage` event.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    writeUiLocale(next);
    applyLocaleToDocument(next);
    setLocaleState(next);
    console.log("[i18n] locale selected", next);
  }, []);

  useEffect(() => {
    void syncNativeLocale(locale);
  }, [locale]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.endsWith(":ui_locale")) return;
      const next = readUiLocale();
      setLocaleState(next);
      applyLocaleToDocument(next);
      console.log("[i18n] locale synced from another window", next);
    };
    window.addEventListener("storage", onStorage);

    let unlisten: (() => void) | undefined;
    void listen<string>("ui-locale-changed", (event) => {
      const next: Locale = event.payload === "en" ? "en" : "zh";
      setLocaleState((current) => {
        if (current === next) return current;
        writeUiLocale(next);
        applyLocaleToDocument(next);
        console.log("[i18n] locale applied from native event", next);
        return next;
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      window.removeEventListener("storage", onStorage);
      unlisten?.();
    };
  }, []);

  const value = useMemo<I18nValue>(() => ({ locale, m: catalogs[locale], setLocale }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}
