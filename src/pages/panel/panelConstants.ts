/**
 * Canonical size constants + small text helpers for the floating IME panel.
 *
 * Sizing model (current):
 * - EXPANDED panel width is FIXED at 1280 (default == min == max; not manually resizable).
 * - EXPANDED panel height auto-sizes to wrapped content, bounded by [400, 720].
 * - COLLAPSED toolbar uses computeCollapsedWindowSize() (4 icons); OS min matches that size.
 */

/** Expanded panel FIXED logical width (default, min, and max — never changes). */
export const PANEL_EXPANDED_DEFAULT_WIDTH = 1280;
/** Expanded panel DEFAULT logical height (also the min). */
export const PANEL_EXPANDED_DEFAULT_HEIGHT = 400;
/** Expanded panel width cap (== default; width does not auto-grow or shrink). */
export const PANEL_EXPANDED_MAX_WIDTH = 1280;
/** Expanded panel MAX logical height — content taller than this scrolls inside the editor body. */
export const PANEL_EXPANDED_MAX_HEIGHT = 720;
/** Expanded panel MIN logical width (== default fixed width). */
export const PANEL_EXPANDED_MIN_WIDTH = PANEL_EXPANDED_DEFAULT_WIDTH;
/** Expanded panel MIN logical height (== default; manual resize is disabled). */
export const PANEL_EXPANDED_MIN_HEIGHT = PANEL_EXPANDED_DEFAULT_HEIGHT;

/** Collapsed icon button size — must match `.ime-icon-btn` in panel.css. */
export const COLLAPSED_ICON_BTN_PX = 38;
/** Gap between collapsed icons — must match `.ime-rail-cluster--main { gap }`. */
export const COLLAPSED_ICON_GAP_PX = 6;
export const COLLAPSED_ICON_COUNT = 4;
/** Shell horizontal padding — must match collapsed shell CSS (`6px 10px`). */
export const COLLAPSED_SHELL_PAD_X_PX = 20;
/** Shell vertical padding — must match collapsed shell CSS (`6px 10px`). */
export const COLLAPSED_SHELL_PAD_Y_PX = 12;
/** Shell border width (1px × 2). */
export const COLLAPSED_SHELL_BORDER_PX = 2;
/** Extra logical px so rounded corners / WebView2 DPI never clip head/tail icons. */
export const COLLAPSED_SIZE_SLACK_W = 65;
export const COLLAPSED_SIZE_SLACK_H = 14;

/**
 * Deterministic collapsed window size (4 icons + gaps + shell chrome + slack).
 * Do NOT measure `width:max-content` DOM — it races with the still-large window frame.
 */
export function computeCollapsedWindowSize(): { width: number; height: number } {
  const clusterW =
    COLLAPSED_ICON_COUNT * COLLAPSED_ICON_BTN_PX +
    (COLLAPSED_ICON_COUNT - 1) * COLLAPSED_ICON_GAP_PX;
  const clusterH = COLLAPSED_ICON_BTN_PX;
  return {
    width:
      clusterW + COLLAPSED_SHELL_PAD_X_PX + COLLAPSED_SHELL_BORDER_PX + COLLAPSED_SIZE_SLACK_W,
    height:
      clusterH + COLLAPSED_SHELL_PAD_Y_PX + COLLAPSED_SHELL_BORDER_PX + COLLAPSED_SIZE_SLACK_H,
  };
}

const COLLAPSED_COMPUTED = computeCollapsedWindowSize();

/** Collapsed-toolbar min size — must be >= computeCollapsedWindowSize() or OS min clips icons. */
export const PANEL_COLLAPSED_MIN_WIDTH = COLLAPSED_COMPUTED.width;
export const PANEL_COLLAPSED_MIN_HEIGHT = COLLAPSED_COMPUTED.height;

/**
 * Upper bounds for the panel window, used as the OS setMaxSize() safety cap for the
 * expanded state (== the max above). Kept as separate symbols so the collapse path can
 * pass a generous max without re-tightening the expanded cap.
 */
export const PANEL_MAX_WIDTH = PANEL_EXPANDED_MAX_WIDTH;
export const PANEL_MAX_HEIGHT = PANEL_EXPANDED_MAX_HEIGHT;

/**
 * Expanded default logical size. The panel window is created at this size
 * (tauri.conf.json) and reset to this size every time it is opened; Panel.tsx then
 * refines it via mirror measurement. The shell fills the window via CSS
 * (width/height 100%), so the window IS the visible UI — one layer, no halo.
 */
export const EXPANDED_PANEL_WIDTH = PANEL_EXPANDED_DEFAULT_WIDTH;
export const EXPANDED_PRESET_WIDTH = PANEL_EXPANDED_DEFAULT_WIDTH;
export const EXPANDED_PRESET_HEIGHT = PANEL_EXPANDED_DEFAULT_HEIGHT;

/** Collapsed toolbar preset — same as computeCollapsedWindowSize(). */
export const COLLAPSED_PRESET_WIDTH = COLLAPSED_COMPUTED.width;
export const COLLAPSED_PRESET_HEIGHT = COLLAPSED_COMPUTED.height;

/** @deprecated Use computeCollapsedWindowSize() — kept for log labels only. */
export const COLLAPSED_SHELL_WIDTH = COLLAPSED_COMPUTED.width;
/** @deprecated Use computeCollapsedWindowSize() — kept for log labels only. */
export const COLLAPSED_SHELL_HEIGHT = COLLAPSED_COMPUTED.height;

/**
 * Fixed horizontal chrome outside `.ime-editor-body` (shell border/pad + layout gap +
 * 38px rail + editor-panel horizontal padding). Matches `panel.css` — do NOT read from
 * flex-filled DOM (circular: window width → pane width → chrome estimate → window width).
 */
export const EXPANDED_H_CHROME_OUTSIDE_BODY = 68;

/** Extra horizontal reserve when the command popover is open (`.ime-rail-anchor--command-open-expanded`). */
export const EXPANDED_COMMAND_POPOVER_RESERVE = 256;

/**
 * Fixed vertical chrome outside `.ime-editor-body` (topline + hint + feedback + gaps +
 * shell/editor-panel padding). Do NOT use `editorPanel.offsetHeight - editorBody.offsetHeight`
 * — the body is flex-filled to the window so that delta is NOT the true chrome.
 */
export const EXPANDED_V_CHROME_OUTSIDE_BODY = 148;

/** Minimum wrapped body height (empty textarea mirror). Keeps empty panel at default 400h. */
export const EXPANDED_BODY_MIN_HEIGHT = 72;

/** Gap from the working-area edge when the collapsed toolbar parks at the bottom-right corner. */
export const PANEL_SCREEN_MARGIN = 18;

/** Horizontal gap between the input textarea and the result pane inside `.ime-editor-body`
 *  (must match the CSS `gap` on `.ime-editor-body`). Used by the mirror-based width math. */
export const EDITOR_BODY_GAP = 10;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Measure the pixel width of the longest line using an off-screen mirror element. */
export function measureLongestLineWidth(mirror: HTMLElement, text: string): number {
  const lines = text.length ? text.split("\n") : [" "];
  mirror.style.display = "inline-block";
  mirror.style.width = "max-content";
  mirror.style.maxWidth = "none";
  mirror.style.whiteSpace = "pre";
  let maxW = 0;
  for (const line of lines) {
    mirror.textContent = line.length ? line : " ";
    maxW = Math.max(maxW, Math.ceil(mirror.getBoundingClientRect().width));
  }
  return maxW;
}

/** Measure wrapped block height at a fixed content width using an off-screen mirror. */
export function measureWrappedHeight(mirror: HTMLElement, text: string, contentWidthPx: number): number {
  mirror.style.display = "block";
  mirror.style.width = `${contentWidthPx}px`;
  mirror.style.maxWidth = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.textContent = text.length ? text : " ";
  return Math.ceil(mirror.getBoundingClientRect().height);
}

/** 0-based line index of the caret in a plain-text value (split by `\n`). */
export function lineIndexAtCaret(text: string, caret: number): number {
  const c = Math.min(Math.max(0, caret), text.length);
  let line = 0;
  for (let i = 0; i < c; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

export function totalLineCount(text: string): number {
  if (text.length === 0) return 1;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  return lines;
}
