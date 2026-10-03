import type { LlmProvider, TranslationProvider } from "../api";
import type { Locale } from "./locale";

/** Short provider names shown in selects, the home hero, and the panel chip. */
const LLM_LABELS: Record<Locale, Record<LlmProvider, string>> = {
  zh: {
    lm_studio: "LM Studio（本机）",
    open_router: "OpenRouter",
    openai: "OpenAI",
    nvidia_nim: "NVIDIA NIM",
    deepseek: "DeepSeek",
    groq: "Groq",
    together: "Together AI",
    siliconflow: "SiliconFlow（硅基流动）",
    moonshot: "Moonshot（Kimi）",
    custom: "自定义 base URL",
  },
  en: {
    lm_studio: "LM Studio (local)",
    open_router: "OpenRouter",
    openai: "OpenAI",
    nvidia_nim: "NVIDIA NIM",
    deepseek: "DeepSeek",
    groq: "Groq",
    together: "Together AI",
    siliconflow: "SiliconFlow",
    moonshot: "Moonshot (Kimi)",
    custom: "Custom base URL",
  },
};

const TRANSLATION_LABELS: Record<Locale, Record<TranslationProvider, string>> = {
  zh: {
    llm: "大模型提示词（默认）",
    deepl: "DeepL",
    baidu: "百度翻译",
    youdao: "有道翻译",
    azure: "Azure Translator",
    google: "Google Cloud Translation",
  },
  en: {
    llm: "LLM prompt (default)",
    deepl: "DeepL",
    baidu: "Baidu Translate",
    youdao: "Youdao Translate",
    azure: "Azure Translator",
    google: "Google Cloud Translation",
  },
};

export function llmProviderLabel(id: LlmProvider, locale: Locale): string {
  return LLM_LABELS[locale][id] ?? id;
}

export function translationProviderLabel(id: TranslationProvider, locale: Locale): string {
  return TRANSLATION_LABELS[locale][id] ?? id;
}

export const TRANSLATION_PROVIDER_IDS = Object.keys(TRANSLATION_LABELS.zh) as TranslationProvider[];
