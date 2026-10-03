import type { Locale } from "./locale";

/**
 * Backend and a few persisted panel errors are stored as Chinese source text.
 * Map both the Chinese source and its English form so a language switch updates
 * text that is already on screen.
 */
const PAIRS: Array<{ zh: RegExp; en: string | ((match: RegExpMatchArray) => string) }> = [
  { zh: /^模型竞争未开启$/, en: "Model competition is off." },
  {
    zh: /^当前为「大模型提示词」模式，无需专用翻译 API。$/,
    en: "Translation is using the LLM prompt. No dedicated translation API is required.",
  },
  {
    zh: /^未找到 (.+) API Key：请在「模型与连接」填写密钥并点击「保存模型设置」。$/,
    en: (match) => {
      const name = match[1] === "自定义 API" ? "Custom API" : match[1];
      return `No ${name} API key. Enter it under Models and click Save model settings.`;
    },
  },
  {
    zh: /^当前焦点在本应用：请先在要输入的外部软件里点一下文本框，再插入；或切到该软件后用全局「插入结果」快捷键。$/,
    en: "Focus is still in this app. Click the text field in the other app, then insert again, or switch to that app and use the global insert shortcut.",
  },
  { zh: /^无法确定要粘贴的目标窗口$/, en: "Could not find a window to paste into." },
  {
    zh: /^\/models 响应中未找到 data\[\]\.id 列表（可能不是 OpenAI 兼容列表格式）$/,
    en: "The /models response has no data[].id list. The endpoint may not be OpenAI-compatible.",
  },
  {
    zh: /^模型输出未按阿拉伯数字编号拆分，请重试或改为逐条处理$/,
    en: "The model output was not split by Arabic numerals. Retry, or process items one by one.",
  },
  {
    zh: /^队列已满（最多 (\d+) 条未完成任务）$/,
    en: (match) => `Queue is full (at most ${match[1]} unfinished tasks)`,
  },
  {
    zh: /^队列剩余空位 (\d+)，已入队前 (\d+) 段；其余 (\d+) 段未加入$/,
    en: (match) =>
      `${match[1]} free slots left. The first ${match[2]} segments were queued; ${match[3]} were not added`,
  },
  {
    zh: /^请先停止当前生成，再清空队列$/,
    en: "Stop the current generation before clearing the queue",
  },
  { zh: /^请先开启模型竞争并保存设置。$/, en: "Turn on model competition and save before probing." },
];

function englishOf(raw: string): string | null {
  for (const pair of PAIRS) {
    const match = raw.match(pair.zh);
    if (!match) continue;
    return typeof pair.en === "function" ? pair.en(match) : pair.en;
  }
  return null;
}

function chineseOf(raw: string): string | null {
  for (const pair of PAIRS) {
    if (typeof pair.en === "string") {
      if (raw === pair.en) {
        const back = pair.zh.source.replace(/^\^/, "").replace(/\$$/, "").replace(/\\\./g, ".");
        return back;
      }
      continue;
    }
    // Function pairs are matched from the Chinese source only when displaying English.
  }
  return null;
}

/** Show a stored or backend message in the active language. */
export function presentRuntimeText(raw: string, locale: Locale): string {
  const text = raw.trim();
  if (locale === "en") {
    return englishOf(text) ?? raw;
  }
  return chineseOf(text) ?? raw;
}
