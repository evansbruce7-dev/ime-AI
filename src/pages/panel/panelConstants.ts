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
/** Collapsed dock shows only the keyboard icon. */
export const COLLAPSED_ICON_COUNT = 1;
/** Shell horizontal padding (left + right) — must match collapsed shell CSS (`padding: 4px`). */
export const COLLAPSED_SHELL_PAD_X_PX = 8;
/** Shell vertical padding (top + bottom) — must match collapsed shell CSS (`padding: 4px`). */
export const COLLAPSED_SHELL_PAD_Y_PX = 8;
/** Shell border width (1px × 2). */
export const COLLAPSED_SHELL_BORDER_PX = 2;
/**
 * Only ONE transparent CSS px of slack (was 65×14). The collapsed shell now HUGS its icons and the
 * window is sized to the measured shell box, so there is no spare area that could show up as an
 * empty panel on another machine. The single px absorbs fractional-DPI rounding (e.g. 125%/175%)
 * so the 1px border / rounded corner on the right and bottom edge is never clipped.
 */
export const COLLAPSED_SIZE_SLACK_W = 1;
export const COLLAPSED_SIZE_SLACK_H = 1;

/**
 * Formula collapsed window size (keyboard icon + shell chrome + 1px slack). It is the FALLBACK
 * and the OS minimum; the real size comes from measuring the hugging shell in `Panel.tsx`
 * (`measureCollapsedShellSize`), which also adapts if the icon set ever changes.
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

/**
 * Extra width consumed when the command card is open, beyond the closed layout.
 * Closed: 38px rail + 6px layout gap.
 * Open: 38px rail + 8px clearance + 240px card, and the layout gap drops to 0
 * so the card's right edge meets the editor.
 * Delta = (38 + 8 + 240) - (38 + 6) = 242.
 */
export const EXPANDED_COMMAND_POPOVER_RESERVE = 242;

/**
 * Fixed vertical chrome outside `.ime-editor-body` (topline + hint + feedback + gaps +
 * shell/editor-panel padding). Do NOT use `editorPanel.offsetHeight - editorBody.offsetHeight`
 * — the body is flex-filled to the window so that delta is NOT the true chrome.
 */
export const EXPANDED_V_CHROME_OUTSIDE_BODY = 148;

/** Minimum wrapped body height (empty textarea mirror). Keeps empty panel at default 400h. */
export const EXPANDED_BODY_MIN_HEIGHT = 72;

/**
 * The 1280×400 layout was drawn for a 1920×1080 CSS-pixel screen (100% scaling).
 * On a 1920×1080 monitor at 150%, the page only has ~1280×680 CSS pixels, so a 1280×400
 * panel covers the whole width and more than half the height. Scale the design down so it
 * keeps the same fraction of the screen. At or above ~1080p CSS pixels the scale stays 1,
 * which is why a 100%/4K machine looks unchanged.
 */
export const PANEL_DESIGN_SCREEN_WIDTH = 1920;
export const PANEL_DESIGN_SCREEN_HEIGHT = 1080;

export function panelScreenScale(availWidth: number, availHeight: number): number {
  if (!(availWidth > 0) || !(availHeight > 0)) return 1;
  const raw = Math.min(
    availWidth / PANEL_DESIGN_SCREEN_WIDTH,
    availHeight / PANEL_DESIGN_SCREEN_HEIGHT,
  );
  if (!Number.isFinite(raw) || raw >= 0.92) return 1;
  return Math.max(0.55, raw);
}

/** Expanded width / min height / max height after `panelScreenScale`. */
export function scaledExpandedBounds(availWidth: number, availHeight: number): {
  scale: number;
  width: number;
  minHeight: number;
  maxHeight: number;
} {
  const scale = panelScreenScale(availWidth, availHeight);
  return {
    scale,
    width: Math.round(PANEL_EXPANDED_MAX_WIDTH * scale),
    minHeight: Math.round(PANEL_EXPANDED_MIN_HEIGHT * scale),
    maxHeight: Math.round(PANEL_EXPANDED_MAX_HEIGHT * scale),
  };
}

/** Gap from the working-area edge when the collapsed toolbar parks at the bottom-right corner.
 *  Also the margin kept on every side when the expanded panel is fitted to a small screen.
 *  Mirrors `PANEL_SCREEN_MARGIN` in `src-tauri/src/lib.rs`. */
export const PANEL_SCREEN_MARGIN = 18;

/** Logical work area (monitor minus taskbar) of the screen the panel is on. */
export interface WorkAreaLogical {
  width: number;
  height: number;
}

/**
 * Clamp a requested panel size so it fits inside the work area with `PANEL_SCREEN_MARGIN` on
 * every side. `workArea === null` (not measured yet) leaves the size untouched.
 * This is what makes the panel adapt to resolution AND Windows display scaling: the work area is
 * physical pixels / scale factor, so 1920×1080 @150% is a 1280×~690 logical screen and the
 * 1280-wide design size is shrunk to fit instead of covering the whole screen.
 */
export function fitToWorkArea(
  width: number,
  height: number,
  workArea: WorkAreaLogical | null,
): { width: number; height: number } {
  if (!workArea || !(workArea.width > 0) || !(workArea.height > 0)) {
    return { width, height };
  }
  const maxW = Math.max(1, workArea.width - 2 * PANEL_SCREEN_MARGIN);
  const maxH = Math.max(1, workArea.height - 2 * PANEL_SCREEN_MARGIN);
  return { width: Math.min(width, maxW), height: Math.min(height, maxH) };
}

/** After a resize, wait for the webview viewport to stop changing, at most this long (ms). */
export const PANEL_VIEWPORT_SETTLE_MAX_MS = 360;
/** Poll interval while waiting for the viewport to settle (ms). */
export const PANEL_VIEWPORT_POLL_MS = 40;
/** Viewport may differ from the requested size by this many CSS px before we correct it. */
export const PANEL_VIEWPORT_TOLERANCE_PX = 1.5;

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
