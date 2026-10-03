import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { LogicalPosition, currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import {
  cancelLlmStream,
  clearPendingInjectText,
  copyToClipboard,
  defaultQueueSettings,
  getSettings,
  listCommands,
  revealPanelFirstPaint,
  runLlmStream,
  setPanelZorderMode,
  setPendingInjectText,
  showSettingsCmd,
  showWorkspacePageCmd,
  syncPanelWindowGeometry,
  type AppSettings,
  type PanelZorderMode,
  type PromptCommand,
} from "../api";
import { pushInputHistory, readInputHistory, historyPreview, readMenuStylePreset, writeMenuStylePreset, type InputHistoryEntry, type MenuStylePreset } from "../lib/prefs";
import { useI18n } from "../i18n/context";
import { readUiLocale } from "../i18n/locale";
import { catalogs } from "../i18n/messages";
import { presentRuntimeText } from "../i18n/present";
import {
  assembleQueueResults,
  assembleQueueSources,
  buildIsolatedBatchPrompt,
  clampQueueSize,
  createQueueItem,
  nextQueueSeq,
  parseNumberedResultBlocks,
  queueStatusLabel,
  readProcessQueue,
  splitIntoIsolatedSources,
  writeProcessQueue,
  type QueueItem,
} from "../lib/queue";
import { recordLlmUsage } from "../lib/stats";
import {
  formatProviderChip,
  competitionPanelTags,
  getCommandDescription,
  getCommandShortLabel,
  getNextStylePreset,
  shortcutDisplayLabel,
  stylePresetLabel,
  visibleCommandTitle,
} from "./panel/panelCommandMeta";
import {
  clamp,
  computeCollapsedWindowSize,
  EDITOR_BODY_GAP,
  EXPANDED_BODY_MIN_HEIGHT,
  EXPANDED_COMMAND_POPOVER_RESERVE,
  EXPANDED_H_CHROME_OUTSIDE_BODY,
  EXPANDED_PANEL_WIDTH,
  EXPANDED_PRESET_HEIGHT,
  EXPANDED_V_CHROME_OUTSIDE_BODY,
  lineIndexAtCaret,
  measureWrappedHeight,
  PANEL_COLLAPSED_MIN_HEIGHT,
  PANEL_COLLAPSED_MIN_WIDTH,
  PANEL_EXPANDED_MAX_HEIGHT,
  PANEL_EXPANDED_MAX_WIDTH,
  PANEL_EXPANDED_MIN_HEIGHT,
  PANEL_EXPANDED_MIN_WIDTH,
  PANEL_MAX_HEIGHT,
  PANEL_MAX_WIDTH,
  PANEL_SCREEN_MARGIN,
  totalLineCount,
} from "./panel/panelConstants";
import { IconInfoOutline, IconInputHistory, IconNewTask, IconQueue, IconStatsOutline } from "./panel/panelIcons";

type Phase = "idle" | "running" | "review" | "error";
type PanelPlacement = "center" | "bottom-right";

/** Fallback default command when settings / list are unavailable. */
const DEFAULT_COMMAND_ID = "translate_en";

/** Pick default command id from settings.queue + loaded command list. */
function resolveDefaultCommandId(list: PromptCommand[], preferred?: string | null): string {
  const want = (preferred || DEFAULT_COMMAND_ID).trim() || DEFAULT_COMMAND_ID;
  if (list.some((c) => c.id === want)) return want;
  if (list.some((c) => c.id === DEFAULT_COMMAND_ID)) return DEFAULT_COMMAND_ID;
  return list[0]?.id ?? DEFAULT_COMMAND_ID;
}

/** Active unfinished items count toward the max-size gate. */
function countActiveQueueItems(items: QueueItem[]): number {
  return items.filter((x) => x.status === "pending" || x.status === "running" || x.status === "error").length;
}

export function PanelPage() {
  const { locale, m } = useI18n();
  const copy = m.panel;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [cmds, setCmds] = useState<PromptCommand[]>([]);
  const [cmdId, setCmdId] = useState("");
  const [inputText, setInputText] = useState("");
  const [resultText, setResultText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [stylePreset, setStylePreset] = useState<MenuStylePreset>(() => readMenuStylePreset());
  const [zorderMode, setZorderMode] = useState<PanelZorderMode>("default");
  const [copiedFlash, setCopiedFlash] = useState(false);
  const lastWindowSizeRef = useRef("");
  const pendingPlacementRef = useRef<PanelPlacement | null>(null);
  const frameRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const editorPanelRef = useRef<HTMLElement | null>(null);
  const editorBodyRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const inputTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resultAreaRef = useRef<HTMLDivElement | null>(null);
  // Hidden off-screen mirrors that share the real textarea / result <pre> font, padding and
  // wrapping rules. Panel.tsx measures them to auto-size the expanded window to its content
  // (longest input line → width, wrapped content → height) without the circularity of
  // measuring the flex-filled, window-sized real elements.
  const inputMirrorRef = useRef<HTMLDivElement | null>(null);
  const resultMirrorRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = inputTextareaRef; // keep legacy alias for focus helpers
  const settingsRef = useRef<AppSettings | null>(null);
  settingsRef.current = settings;
  const historyRowRef = useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<InputHistoryEntry[]>(() => readInputHistory());
  /** Processing queue (prefill + sequential worker). */
  const [queue, setQueue] = useState<QueueItem[]>([]);
  /** Queue details popover (header icon); default closed so it never steals editor chrome. */
  const [queueOpen, setQueueOpen] = useState(false);
  /** Ref-synced `inputText` / `phase` so the global `panel-opened` handler can read latest editor state (refs avoid stale closures). */
  const inputTextRef = useRef(inputText);
  const phaseRef = useRef(phase);
  inputTextRef.current = inputText;
  phaseRef.current = phase;
  const prevExpandedRef = useRef(false);
  /** Latest flags for size sync (avoid stale closures in async handlers). */
  const panelLayoutRef = useRef({ expanded: false, commandOpen: false });
  panelLayoutRef.current = { expanded, commandOpen };
  /** True while a queue-driven LLM job is in flight (suppresses auto-inject). */
  const fromQueueRef = useRef(false);
  /** True while the sequential queue worker loop owns the run slot. */
  const queueWorkerBusyRef = useRef(false);
  /** After user cancel, do not auto-advance to the next pending item. */
  const queueStopAfterCancelRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;
  /** History / queue capacity from settings (defaults to 10). */
  const historyMaxRef = useRef(10);
  historyMaxRef.current = clampQueueSize(settings?.queue?.max_queue_size ?? 10);

  const focusEditor = useCallback(() => {
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const resetSession = useCallback(() => {
    setInputText("");
    setResultText("");
    setCopiedFlash(false);
    setErrorMsg(null);
    setBusy(false);
    setPhase("idle");
    pendingPlacementRef.current = "bottom-right";
    flushSync(() => {
      setExpanded(false);
      setCommandOpen(false);
    });
    lastWindowSizeRef.current = "";
    void clearPendingInjectText().catch(() => {});
    console.log("[toolbar] session reset (collapsed)");
  }, []);

  const clearWorkSessionKeepExpanded = useCallback(() => {
    setInputText("");
    setResultText("");
    setCopiedFlash(false);
    setErrorMsg(null);
    setBusy(false);
    setPhase("idle");
    setCommandOpen(false);
    lastWindowSizeRef.current = "";
    void clearPendingInjectText().catch(() => {});
    console.log("[toolbar] clear work session (keep expanded)");
  }, []);

  /** New task: clear editor/result, default command from settings.queue, keep panel expanded. */
  const startNewTask = useCallback(() => {
    if (phase === "running") {
      console.log("[toolbar] startNewTask ignored — still running");
      return;
    }
    const preferred = settingsRef.current?.queue?.default_command_id;
    const nextCmdId = resolveDefaultCommandId(cmds, preferred);
    clearWorkSessionKeepExpanded();
    setHistoryOpen(false);
    setQueueOpen(false);
    setCmdId(nextCmdId);
    setExpanded(true);
    focusEditor();
    console.log("[toolbar] startNewTask", { commandId: nextCmdId });
  }, [clearWorkSessionKeepExpanded, cmds, focusEditor, phase]);

  const applyPanelGeometry = useCallback(
    async (opts: {
      width: number;
      height: number;
      minWidth?: number;
      minHeight?: number;
      maxWidth?: number;
      maxHeight?: number;
      cacheExpandedSize?: boolean;
    }) => {
      await syncPanelWindowGeometry({
        width: opts.width,
        height: opts.height,
        minWidth: opts.minWidth,
        minHeight: opts.minHeight,
        maxWidth: opts.maxWidth,
        maxHeight: opts.maxHeight,
        cacheExpandedSize: opts.cacheExpandedSize ?? false,
      });
    },
    [],
  );

  const measureCollapsedShellSize = useCallback(() => computeCollapsedWindowSize(), []);

  const placeWindowForPanelState = useCallback(async (width: number, height: number, placement: PanelPlacement, reason: string) => {
    if (placement === "center") {
      await getCurrentWindow().center();
      console.log("[toolbar] panel placement applied", {
        placement,
        reason,
        width,
        height,
        via: "WebviewWindow.center()",
      });
      return;
    }

    const monitor = (await currentMonitor().catch(() => null)) ?? (await primaryMonitor().catch(() => null));
    if (!monitor) {
      console.warn("[toolbar] panel placement skipped: no monitor", { width, height, placement, reason });
      return;
    }

    const scaleFactor = monitor.scaleFactor || 1;
    const workLeft = monitor.workArea.position.x / scaleFactor;
    const workTop = monitor.workArea.position.y / scaleFactor;
    const workWidth = monitor.workArea.size.width / scaleFactor;
    const workHeight = monitor.workArea.size.height / scaleFactor;
    const maxLeft = workLeft + workWidth - width - PANEL_SCREEN_MARGIN;
    const maxTop = workTop + workHeight - height - PANEL_SCREEN_MARGIN;
    const nextLeft =
      placement === "bottom-right"
        ? maxLeft
        : workLeft + Math.max(PANEL_SCREEN_MARGIN, (workWidth - width) / 2);
    const nextTop =
      placement === "bottom-right"
        ? maxTop
        : workTop + Math.max(PANEL_SCREEN_MARGIN, (workHeight - height) / 2);
    const clampedLeft = clamp(nextLeft, workLeft + PANEL_SCREEN_MARGIN, Math.max(workLeft + PANEL_SCREEN_MARGIN, maxLeft));
    const clampedTop = clamp(nextTop, workTop + PANEL_SCREEN_MARGIN, Math.max(workTop + PANEL_SCREEN_MARGIN, maxTop));

    // Position only — size + min constraints were already applied by syncFrameToWindow.
    await getCurrentWindow().setPosition(new LogicalPosition(Math.round(clampedLeft), Math.round(clampedTop)));
    console.log("[toolbar] panel placement applied", {
      placement,
      reason,
      width,
      height,
      x: Math.round(clampedLeft),
      y: Math.round(clampedTop),
      monitor: monitor.name,
      scaleFactor,
    });
  }, []);

  const consumePendingPlacement = useCallback(
    (width: number, height: number, reason: string) => {
      const placement = pendingPlacementRef.current;
      if (!placement) return;
      pendingPlacementRef.current = null;
      void placeWindowForPanelState(width, height, placement, reason).catch((error) => {
        console.warn("[toolbar] panel placement failed", { placement, reason, error });
      });
    },
    [placeWindowForPanelState],
  );

  const collapseWindowToBottomRight = useCallback(
    async (reason: string) => {
      pendingPlacementRef.current = "bottom-right";
      lastWindowSizeRef.current = "";
      const { width, height } = measureCollapsedShellSize();
      await applyPanelGeometry({
        width,
        height,
        minWidth: PANEL_COLLAPSED_MIN_WIDTH,
        minHeight: PANEL_COLLAPSED_MIN_HEIGHT,
        // Lock max to collapsed size so the OS frame cannot stay at expanded dimensions.
        maxWidth: width,
        maxHeight: height,
      });
      await placeWindowForPanelState(width, height, "bottom-right", reason);
      console.log("[toolbar] collapsed window parked bottom-right", {
        reason,
        width,
        height,
      });
    },
    [applyPanelGeometry, measureCollapsedShellSize, placeWindowForPanelState],
  );

  const syncFrameToWindow = useCallback(() => {
    const { expanded: isExpanded, commandOpen: isCommandOpen } = panelLayoutRef.current;

    if (isExpanded) {
      const inputMirror = inputMirrorRef.current;
      if (!inputMirror) {
        return;
      }
      const resultMirror = resultMirrorRef.current;
      const split = phase === "running" || phase === "review";

      // Width is fixed at 1280 — only height auto-grows with wrapped content.
      const nextW = PANEL_EXPANDED_MAX_WIDTH;
      const chromeH =
        EXPANDED_H_CHROME_OUTSIDE_BODY + (isCommandOpen ? EXPANDED_COMMAND_POPOVER_RESERVE : 0);
      const paneBoxW = split
        ? (nextW - chromeH - EDITOR_BODY_GAP) / 2
        : nextW - chromeH;

      const inputWrappedH = measureWrappedHeight(inputMirror, inputText, paneBoxW);
      let resultWrappedH = 0;
      if (split && resultMirror) {
        resultWrappedH = measureWrappedHeight(resultMirror, resultText, paneBoxW);
      }
      const bodyContentH = Math.max(
        EXPANDED_BODY_MIN_HEIGHT,
        split ? Math.max(inputWrappedH, resultWrappedH) : inputWrappedH,
      );
      const nextH = clamp(
        bodyContentH + EXPANDED_V_CHROME_OUTSIDE_BODY,
        PANEL_EXPANDED_MIN_HEIGHT,
        PANEL_EXPANDED_MAX_HEIGHT,
      );

      const sizeKey = `expanded:${nextW}x${nextH}`;
      if (sizeKey === lastWindowSizeRef.current) {
        consumePendingPlacement(nextW, nextH, "expanded-size-unchanged");
        return;
      }
      lastWindowSizeRef.current = sizeKey;
      void applyPanelGeometry({
        width: nextW,
        height: nextH,
        minWidth: PANEL_EXPANDED_MIN_WIDTH,
        minHeight: PANEL_EXPANDED_MIN_HEIGHT,
        maxWidth: PANEL_MAX_WIDTH,
        maxHeight: PANEL_MAX_HEIGHT,
        cacheExpandedSize: true,
      })
        .then(() => {
          consumePendingPlacement(nextW, nextH, "expanded-size-sync");
          console.log("[toolbar] syncFrameToWindow (expanded, fixed width)", {
            nextW,
            nextH,
            paneBoxW: Math.round(paneBoxW),
            chromeH,
            bodyContentH,
            split,
          });
        })
        .catch((error) => {
          console.warn("[toolbar] syncFrameToWindow (expanded) failed", error);
        });
      return;
    }

    const { width: nextWidth, height: nextHeight } = measureCollapsedShellSize();
    const sizeKey = `collapsed:${nextWidth}x${nextHeight}`;
    if (sizeKey === lastWindowSizeRef.current) {
      consumePendingPlacement(nextWidth, nextHeight, "collapsed-size-unchanged");
      return;
    }
    lastWindowSizeRef.current = sizeKey;
    void applyPanelGeometry({
      width: nextWidth,
      height: nextHeight,
      minWidth: PANEL_COLLAPSED_MIN_WIDTH,
      minHeight: PANEL_COLLAPSED_MIN_HEIGHT,
      maxWidth: nextWidth,
      maxHeight: nextHeight,
    })
      .then(() => {
        consumePendingPlacement(nextWidth, nextHeight, "collapsed-size-sync");
        console.log("[toolbar] syncFrameToWindow (collapsed, fixed size)", { nextWidth, nextHeight });
      })
      .catch((error) => {
        console.warn("[toolbar] syncFrameToWindow (collapsed) failed", error);
      });
  }, [
    applyPanelGeometry,
    consumePendingPlacement,
    inputText,
    measureCollapsedShellSize,
    phase,
    resultText,
  ]);

  const syncFrameToWindowRef = useRef<() => void>(() => {});
  syncFrameToWindowRef.current = syncFrameToWindow;

  const runLlmJob = useCallback(
    async (
      rawInput: string,
      options?: {
        /** Override panel cmdId (used by queue items). */
        commandId?: string;
        /** When true, skip auto-inject side effects and update the matching queue row. */
        fromQueue?: boolean;
        /** Queue item id to update when fromQueue (single-item run). */
        queueItemId?: string;
        /** Batch: multiple queue item ids sharing one numbered LLM call. */
        queueBatchIds?: string[];
        /** Full prompt override (batch isolation preamble + numbered tasks). */
        promptOverride?: string | null;
        /** Left-pane display (e.g. numbered sources); defaults to rawInput. */
        displayInput?: string;
      },
    ) => {
      const effectiveCmdId = (options?.commandId || cmdId).trim();
      const promptOverride = options?.promptOverride ?? null;
      const batchIds = options?.queueBatchIds?.filter(Boolean) ?? [];
      const isBatch = batchIds.length > 1;
      // Batch uses promptOverride; single queue/normal needs a command id.
      if (!promptOverride && !effectiveCmdId) return;
      if (!rawInput.trim() && !promptOverride) return;

      const fromQueue = options?.fromQueue === true;
      const queueItemId = options?.queueItemId;
      const provider = settingsRef.current?.provider ?? "lm_studio";
      const histMax = historyMaxRef.current;
      const runStartedAt = performance.now();
      const commandTitle = cmds.find((c) => c.id === effectiveCmdId)?.title ?? null;
      fromQueueRef.current = fromQueue;
      setBusy(true);
      setPhase("running");
      setErrorMsg(null);
      setResultText("");
      setCopiedFlash(false);

      const displayInput = options?.displayInput ?? rawInput;
      if (fromQueue) {
        if (effectiveCmdId) setCmdId(effectiveCmdId);
        setInputText(displayInput);
        console.log("[toolbar] queue run shows source in left input", {
          queueItemId: queueItemId ?? null,
          batchIds: isBatch ? batchIds : null,
          commandId: effectiveCmdId || null,
          displayLen: displayInput.length,
          isBatch,
        });
      }

      let unlistenDelta: (() => void) | undefined;
      try {
        unlistenDelta = await listen<{ delta: string }>("llm-stream-delta", (event) => {
          const d = event.payload.delta ?? "";
          if (!d) return;
          setResultText((prev) => prev + d);
        });
        console.log("[toolbar] run_llm_stream", {
          cmdId: effectiveCmdId || null,
          inputLen: rawInput.length,
          provider,
          fromQueue,
          queueItemId: queueItemId ?? null,
          isBatch,
          batchSize: batchIds.length,
          hasPromptOverride: Boolean(promptOverride),
        });
        // Batch: commandId null so dedicated translate APIs don't swallow the numbered list;
        // isolation rules live entirely in promptOverride.
        const result = await runLlmStream({
          commandId: promptOverride ? null : effectiveCmdId,
          promptOverride,
          input: promptOverride ? "" : rawInput,
          useClipboard: false,
          useSelection: false,
        });
        const resolvedMs = Math.round(performance.now() - runStartedAt);
        recordLlmUsage(provider, true, result.total_tokens ?? null);
        setExpanded(true);

        if (fromQueue && isBatch) {
          const parsed = parseNumberedResultBlocks(result.text);
          const batchItems = queueRef.current.filter((x) => batchIds.includes(x.id));
          let matched = 0;
          flushSync(() => {
            setQueue((prev) => {
              const next = prev.map((item) => {
                if (!batchIds.includes(item.id)) return item;
                if (result.cancelled) {
                  return {
                    ...item,
                    status: "cancelled" as const,
                    result: parsed.get(item.seq) ?? result.text,
                    error: undefined,
                  };
                }
                const piece = parsed.get(item.seq);
                if (piece) {
                  return { ...item, status: "done" as const, result: piece, error: undefined };
                }
                // Fallback: if model ignored numbering, only first item gets full text.
                if (parsed.size === 0 && item.id === batchIds[0]) {
                  return { ...item, status: "done" as const, result: result.text, error: undefined };
                }
                return {
                  ...item,
                  status: "error" as const,
                  error: catalogs.zh.panel.batchUnsplit,
                  result: undefined,
                };
              });
              matched = next.filter(
                (x) => batchIds.includes(x.id) && x.status === "done",
              ).length;
              const q = settingsRef.current?.queue ?? defaultQueueSettings();
              writeProcessQueue(next, q.persist_queue, q.max_queue_size);
              queueRef.current = next;
              console.log("[toolbar] queue batch distributed by code", {
                batchSize: batchIds.length,
                matched,
                parsedKeys: [...parsed.keys()],
                cancelled: result.cancelled,
              });
              return next;
            });
          });
          if (result.cancelled) {
            queueStopAfterCancelRef.current = true;
          }
          // Per-item history + assembled panes
          for (const item of batchItems) {
            const updated = queueRef.current.find((x) => x.id === item.id);
            if (updated?.status === "done" && updated.result) {
              pushInputHistory(
                updated.input,
                updated.result,
                { commandId: effectiveCmdId, commandTitle },
                histMax,
              );
            }
          }
          setHistoryItems(readInputHistory(histMax));
          const assembledOut = assembleQueueResults(queueRef.current);
          const assembledIn = assembleQueueSources(
            queueRef.current.filter((x) => batchIds.includes(x.id)),
          );
          // Prefer code-assembled numbered blocks so tasks are always line-separated.
          setResultText(assembledOut || result.text);
          if (assembledIn) setInputText(assembledIn);
          setPhase("review");
          console.log("[toolbar] batch result pane set to numbered blocks", {
            assembled: Boolean(assembledOut.trim()),
            len: (assembledOut || result.text).length,
          });
        } else {
          pushInputHistory(
            rawInput.trim() || displayInput.trim(),
            result.text,
            { commandId: effectiveCmdId, commandTitle },
            histMax,
          );
          setHistoryItems(readInputHistory(histMax));
          if (fromQueue && queueItemId) {
            const nextStatus = result.cancelled ? "cancelled" : "done";
            if (result.cancelled) {
              queueStopAfterCancelRef.current = true;
            }
            flushSync(() => {
              setQueue((prev) => {
                const next = prev.map((item) =>
                  item.id === queueItemId
                    ? {
                        ...item,
                        status: nextStatus as QueueItem["status"],
                        result: result.text,
                        error: undefined,
                      }
                    : item,
                );
                const q = settingsRef.current?.queue ?? defaultQueueSettings();
                writeProcessQueue(next, q.persist_queue, q.max_queue_size);
                queueRef.current = next;
                console.log("[toolbar] queue item finished", {
                  id: queueItemId,
                  status: nextStatus,
                  resultLen: result.text.length,
                });
                return next;
              });
            });
            // Refresh result pane as numbered multi-line summary (1. …\n\n2. …).
            const assembledOut = assembleQueueResults(queueRef.current);
            setResultText(assembledOut || result.text);
            console.log("[toolbar] queue result pane refreshed with numbered blocks", {
              len: (assembledOut || result.text).length,
            });
          } else {
            setResultText(result.text);
          }
          setPhase("review");
        }

        console.log("[toolbar] history saved with result", {
          inputLen: (rawInput.trim() || displayInput.trim()).length,
          resultLen: result.text.length,
          cancelled: result.cancelled,
          max: histMax,
          isBatch,
        });
        queueMicrotask(() => syncFrameToWindowRef.current());
        console.log("[toolbar] run_llm_stream resolved", {
          cmdId: effectiveCmdId || null,
          provider,
          totalMs: resolvedMs,
          resultLen: result.text.length,
          totalTokens: result.total_tokens ?? null,
          cancelled: result.cancelled,
          fromQueue,
          isBatch,
        });
      } catch (error) {
        const failedMs = Math.round(performance.now() - runStartedAt);
        recordLlmUsage(provider, false);
        const message = String(error);
        setErrorMsg(message.length > 280 ? `${message.slice(0, 280)}…` : message);
        setPhase("error");
        setExpanded(true);
        pushInputHistory(
          rawInput.trim() || displayInput.trim(),
          "",
          { commandId: effectiveCmdId, commandTitle },
          histMax,
        );
        setHistoryItems(readInputHistory(histMax));
        if (fromQueue && (queueItemId || isBatch)) {
          const ids = isBatch ? batchIds : queueItemId ? [queueItemId] : [];
          flushSync(() => {
            setQueue((prev) => {
              const next = prev.map((item) =>
                ids.includes(item.id)
                  ? { ...item, status: "error" as const, error: message, result: undefined }
                  : item,
              );
              const q = settingsRef.current?.queue ?? defaultQueueSettings();
              writeProcessQueue(next, q.persist_queue, q.max_queue_size);
              queueRef.current = next;
              console.log("[toolbar] queue item(s) error", { ids, error: message });
              return next;
            });
          });
        }
        queueMicrotask(() => syncFrameToWindowRef.current());
        console.error("[toolbar] run failed", {
          error,
          cmdId: effectiveCmdId || null,
          provider,
          totalMs: failedMs,
          fromQueue,
          isBatch,
        });
      } finally {
        unlistenDelta?.();
        setBusy(false);
        if (!fromQueue) {
          fromQueueRef.current = false;
        }
      }
    },
    [cmdId, cmds],
  );

  const runRef = useRef(runLlmJob);
  runRef.current = runLlmJob;

  /**
   * Queue worker: same-command pending items go in ONE LLM call with Arabic numerals
   * + isolation instructions; code then splits the numbered output back onto each item.
   * Different commands (or dedicated translate APIs) still run one-by-one.
   */
  const processQueueWorker = useCallback(async () => {
    if (queueWorkerBusyRef.current) {
      console.log("[toolbar] queue worker already busy — skip");
      return;
    }
    const qSettings = settingsRef.current?.queue ?? defaultQueueSettings();
    if (!qSettings.enabled) {
      console.log("[toolbar] queue disabled — worker idle");
      return;
    }
    queueWorkerBusyRef.current = true;
    queueStopAfterCancelRef.current = false;
    let processedCount = 0;
    console.log("[toolbar] queue worker start (numbered batch when possible)");
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (queueStopAfterCancelRef.current) {
          console.log("[toolbar] queue worker stop after cancel");
          break;
        }
        const work = queueRef.current.filter(
          (x) => x.status === "pending" || x.status === "error",
        );
        if (!work.length) {
          console.log("[toolbar] queue worker idle — no pending items");
          break;
        }

        // Take the first command group so mixed-command queues stay correct.
        const commandId = work[0].commandId;
        const batch = work.filter((x) => x.commandId === commandId);
        const dedicatedTranslate =
          (settingsRef.current?.translation?.provider ?? "llm") !== "llm" &&
          commandId.startsWith("translate_");

        // Single item OR dedicated translate API → one isolated call per item.
        if (batch.length === 1 || dedicatedTranslate) {
          const pending = batch[0];
          flushSync(() => {
            setQueue((prev) => {
              const next = prev.map((item) =>
                item.id === pending.id
                  ? { ...item, status: "running" as const, error: undefined }
                  : item,
              );
              writeProcessQueue(next, qSettings.persist_queue, qSettings.max_queue_size);
              queueRef.current = next;
              return next;
            });
          });
          console.log("[toolbar] queue worker single-item LLM call", {
            id: pending.id,
            seq: pending.seq,
            commandId: pending.commandId,
            reason: dedicatedTranslate ? "dedicated-translate-api" : "single",
          });
          setInputText(pending.input);
          setCmdId(pending.commandId);
          setResultText("");
          await runRef.current(pending.input, {
            commandId: pending.commandId,
            fromQueue: true,
            queueItemId: pending.id,
          });
          processedCount += 1;
          const justFinished = queueRef.current.find((x) => x.id === pending.id);
          if (justFinished?.status === "error" || justFinished?.status === "cancelled") {
            console.log("[toolbar] queue worker pause", {
              id: pending.id,
              status: justFinished?.status,
            });
            break;
          }
          continue;
        }

        // Multi-item same command → one numbered batch call.
        const cmdPrompt =
          cmds.find((c) => c.id === commandId)?.prompt ??
          catalogs[readUiLocale()].batch.singleFallback;
        const promptOverride = buildIsolatedBatchPrompt(cmdPrompt, batch);
        const displayInput = assembleQueueSources(batch);
        const batchIds = batch.map((x) => x.id);

        flushSync(() => {
          setQueue((prev) => {
            const next = prev.map((item) =>
              batchIds.includes(item.id)
                ? { ...item, status: "running" as const, error: undefined }
                : item,
            );
            writeProcessQueue(next, qSettings.persist_queue, qSettings.max_queue_size);
            queueRef.current = next;
            return next;
          });
        });
        console.log("[toolbar] queue worker numbered batch LLM call", {
          commandId,
          batchSize: batch.length,
          seqs: batch.map((x) => x.seq),
        });
        setCmdId(commandId);
        setInputText(displayInput);
        setResultText("");
        await runRef.current(displayInput, {
          commandId,
          fromQueue: true,
          queueBatchIds: batchIds,
          promptOverride,
          displayInput,
        });
        processedCount += batch.length;

        if (queueStopAfterCancelRef.current) break;
        const anyError = queueRef.current.some(
          (x) => batchIds.includes(x.id) && x.status === "error",
        );
        if (anyError) {
          console.log("[toolbar] queue worker pause after batch parse/error");
          break;
        }
        // Loop again for other command groups still pending.
      }
    } finally {
      queueWorkerBusyRef.current = false;
      fromQueueRef.current = false;
      const snapshot = queueRef.current;
      const assembledOut = assembleQueueResults(snapshot);
      const doneOrPartial = snapshot.filter(
        (x) => x.status === "done" || x.status === "cancelled",
      );
      if (assembledOut.trim()) {
        setResultText(assembledOut);
        setPhase("review");
        const assembledIn = assembleQueueSources(doneOrPartial);
        if (assembledIn.trim()) setInputText(assembledIn);
        console.log("[toolbar] queue results shown (code-assembled)", {
          processedCount,
          resultBlocks: doneOrPartial.filter((x) => x.status === "done").length,
        });
      } else {
        console.log("[toolbar] queue worker end — nothing to assemble", { processedCount });
      }
      queueMicrotask(() => syncFrameToWindowRef.current());
    }
  }, [cmds]);

  const processQueueWorkerRef = useRef(processQueueWorker);
  processQueueWorkerRef.current = processQueueWorker;

  /** Persist helper used by queue mutators. */
  const persistQueueState = useCallback((next: QueueItem[], immediate = false) => {
    const q = settingsRef.current?.queue ?? defaultQueueSettings();
    const clamped = next.slice(0, clampQueueSize(q.max_queue_size * 2)); // allow done+pending briefly
    writeProcessQueue(clamped, q.persist_queue, q.max_queue_size, { immediate });
    return clamped;
  }, []);

  /** Enqueue current editor text as one or more isolated items; optionally start the worker. */
  const enqueueCurrentInput = useCallback(
    (opts?: { start?: boolean; clearInput?: boolean }) => {
      const q = settingsRef.current?.queue ?? defaultQueueSettings();
      const text = inputTextRef.current;
      const trimmed = text.trim();
      if (!trimmed) {
        console.warn("[toolbar] enqueue ignored — empty input");
        return false;
      }
      if (!q.enabled) {
        console.log("[toolbar] queue disabled — falling back to single run");
        void runRef.current(trimmed);
        return true;
      }
      const max = clampQueueSize(q.max_queue_size);
      const active = countActiveQueueItems(queueRef.current);
      const slots = Math.max(0, max - active);
      if (slots <= 0) {
        setErrorMsg(catalogs.zh.panel.queueFull(max));
        setPhase("error");
        setExpanded(true);
        console.warn("[toolbar] enqueue rejected — queue full", { active, max });
        return false;
      }

      // Split so each unit is a separate LLM call (never one stitched prompt).
      const sources = splitIntoIsolatedSources(trimmed);
      const toEnqueue = sources.slice(0, slots);
      if (sources.length > slots) {
        setErrorMsg(catalogs.zh.panel.queuePartial(slots, sources.length - slots));
        setPhase("error");
        console.warn("[toolbar] enqueue truncated to free slots", {
          sources: sources.length,
          slots,
        });
      }

      const commandId = cmdId || resolveDefaultCommandId(cmds, q.default_command_id);
      const commandTitle = cmds.find((c) => c.id === commandId)?.title ?? null;
      let seqCursor = nextQueueSeq(queueRef.current);
      const created: QueueItem[] = [];
      for (const source of toEnqueue) {
        const item = createQueueItem({
          input: source,
          commandId,
          commandTitle,
          seq: seqCursor,
        });
        if (!item) continue;
        created.push(item);
        seqCursor += 1;
      }
      if (!created.length) {
        console.warn("[toolbar] enqueue produced no items after split");
        return false;
      }

      setQueue((prev) => {
        const next = [...prev, ...created];
        persistQueueState(next);
        console.log("[toolbar] enqueued isolated items", {
          count: created.length,
          seqs: created.map((c) => c.seq),
          lengths: created.map((c) => c.input.length),
          max,
        });
        return next;
      });

      const first = created[0];
      if (opts?.clearInput !== false) {
        const willAutoStart = opts?.start === true || q.auto_start_on_enqueue;
        if (!willAutoStart) {
          setInputText("");
          setResultText("");
          setCopiedFlash(false);
          if (phaseRef.current !== "running" && sources.length <= slots) {
            setErrorMsg(null);
            setPhase("idle");
          }
        } else {
          // Prime left pane with the first isolated source only.
          setInputText(first.input);
          setResultText("");
          setCopiedFlash(false);
          if (sources.length <= slots) setErrorMsg(null);
          console.log("[toolbar] left input primed with first isolated source", {
            seq: first.seq,
            totalCreated: created.length,
          });
        }
      }
      const shouldStart = opts?.start === true || q.auto_start_on_enqueue;
      if (shouldStart) {
        void processQueueWorkerRef.current();
      }
      queueMicrotask(() => syncFrameToWindowRef.current());
      return true;
    },
    [cmdId, cmds, persistQueueState],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [list, nextSettings] = await Promise.all([listCommands(), getSettings()]);
        setCmds(list);
        setSettings(nextSettings);
        setZorderMode(nextSettings.panel_zorder_mode ?? "default");
        const q = nextSettings.queue ?? defaultQueueSettings();
        historyMaxRef.current = clampQueueSize(q.max_queue_size);
        setHistoryItems(readInputHistory(historyMaxRef.current));
        // Restore persisted unfinished queue (running → pending inside readProcessQueue).
        const restored = readProcessQueue(q.persist_queue, q.max_queue_size);
        setQueue(restored);
        console.log("[toolbar] queue restored on load", {
          length: restored.length,
          persist: q.persist_queue,
          max: q.max_queue_size,
        });
        if (list.length) {
          setCmdId((prev) => {
            if (prev && list.some((cmd) => cmd.id === prev)) return prev;
            const next = resolveDefaultCommandId(list, q.default_command_id);
            console.log("[toolbar] default command on load", next);
            return next;
          });
        }
        // Auto-resume if there are pending items and auto_start is on.
        if (q.enabled && q.auto_start_on_enqueue && restored.some((x) => x.status === "pending")) {
          console.log("[toolbar] auto-resume queue after restore");
          window.setTimeout(() => {
            void processQueueWorkerRef.current();
          }, 80);
        }
      } catch (error) {
        setErrorMsg(String(error));
        setPhase("error");
        lastWindowSizeRef.current = "";
        flushSync(() => {
          setExpanded(true);
        });
        // Bootstrap the expanded window at the default 1280×400; the layout effect refines height.
        const errW = EXPANDED_PANEL_WIDTH;
        const errH = EXPANDED_PRESET_HEIGHT;
        void applyPanelGeometry({
          width: errW,
          height: errH,
          minWidth: PANEL_EXPANDED_MIN_WIDTH,
          minHeight: PANEL_EXPANDED_MIN_HEIGHT,
          maxWidth: PANEL_MAX_WIDTH,
          maxHeight: PANEL_MAX_HEIGHT,
        }).catch((e) => console.warn("[toolbar] bootstrap on load error failed", e));
        queueMicrotask(() => syncFrameToWindowRef.current());
      }
    })();
  }, [applyPanelGeometry]);

  /**
   * First-paint reveal of the expanded panel.
   *
   * The window is created hidden at 1280×400 (tauri.conf.json). We ask Rust to set the size
   * and show it in one IPC call, so "has the resize taken effect" is confirmed by the IPC
   * resolving rather than by guessing when a browser frame fires (WebView2 throttles rAF for
   * never-shown windows, so a plain rAF+setTimeout dance is unreliable). The main layout
   * effect then refines the size via mirror measurement. A 400ms setTimeout safety net
   * forces a plain show() if the IPC never settles (must never leave the window invisible).
   */
  useLayoutEffect(() => {
    let done = false;

    const width = EXPANDED_PANEL_WIDTH;
    const height = EXPANDED_PRESET_HEIGHT;
    lastWindowSizeRef.current = `expanded:${width}x${height}`;
    console.log("[toolbar] first-paint reveal: default expanded size", { width, height });

    void revealPanelFirstPaint(width, height)
      .then(() => {
        done = true;
        console.log("[toolbar] first-paint reveal: window shown (resize confirmed by backend)", { width, height });
        // One corrective pass so mirror-measured height (if content differs) is applied.
        window.setTimeout(() => {
          lastWindowSizeRef.current = "";
          syncFrameToWindowRef.current();
        }, 120);
      })
      .catch((error) => {
        done = true;
        console.warn("[toolbar] first-paint reveal IPC failed; falling back to plain show()", error);
        void getCurrentWindow()
          .show()
          .catch((showError) => {
            console.error("[toolbar] emergency fallback show() also failed", showError);
          });
      });

    // Absolute safety net: if the IPC never resolves *nor* rejects within 400ms, force show().
    const fallbackTimer = window.setTimeout(() => {
      if (done) return;
      done = true;
      console.warn("[toolbar] first-paint reveal IPC did not settle within 400ms; forcing plain show()");
      void getCurrentWindow()
        .show()
        .catch((error) => {
          console.error("[toolbar] emergency fallback show() also failed", error);
        });
    }, 400);

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    void win.setShadow(false).catch((error) => {
      console.warn("[toolbar] disable shadow failed", error);
    });
    // Safety: ensure the panel is non-resizable by the user even if tauri.conf.json is edited
    // independently. Programmatic setSize() still works (the layout effect drives sizing from
    // mirror measurements); this only disables user drag-resize + the OS resize borders.
    void win.setResizable(false).catch((error) => {
      console.warn("[toolbar] setResizable(false) failed", error);
    });
    // No ResizeObserver / onResized listener: with resizable:false the user cannot resize the
    // window, so native resize events only come from our own setSize(). All sizing is driven by
    // the layout effect (syncFrameToWindow) on content/state changes — adding a listener here
    // would just re-trigger sizing and risk feedback loops.
  }, []);

  /** Toggle document classes so collapsed mode content-hugs (no transparent #root halo). */
  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (expanded) {
      root.classList.add("panel-window-expanded");
      root.classList.remove("panel-window-collapsed");
      body.classList.add("panel-window-expanded");
      body.classList.remove("panel-window-collapsed");
    } else {
      root.classList.add("panel-window-collapsed");
      root.classList.remove("panel-window-expanded");
      body.classList.add("panel-window-collapsed");
      body.classList.remove("panel-window-expanded");
    }
    return () => {
      root.classList.remove("panel-window-expanded", "panel-window-collapsed");
      body.classList.remove("panel-window-expanded", "panel-window-collapsed");
    };
  }, [expanded]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("panel-opened", () => {
      const snapPhase = phaseRef.current;
      const snapInput = inputTextRef.current;
      const trimmed = snapInput.trim();
      const rescueDraft =
        trimmed.length > 0 && (snapPhase === "idle" || snapPhase === "error");
      if (rescueDraft) {
        pushInputHistory(trimmed, undefined, undefined, historyMaxRef.current);
        setHistoryItems(readInputHistory(historyMaxRef.current));
        console.log("[toolbar] panel-opened: unsubmitted draft saved to history", {
          phase: snapPhase,
          trimmedLen: trimmed.length,
          max: historyMaxRef.current,
        });
      }
      clearWorkSessionKeepExpanded();
      if (rescueDraft) {
        setInputText(snapInput);
        console.log("[toolbar] panel-opened: editor restored from rescued draft (raw len)", snapInput.length);
      }
      pendingPlacementRef.current = "center";
      lastWindowSizeRef.current = "";

      // Commit expanded layout, then reset to fixed 1280×400 before centering.
      flushSync(() => {
        setExpanded(true);
      });

      const w = EXPANDED_PANEL_WIDTH;
      const h = EXPANDED_PRESET_HEIGHT;

      void applyPanelGeometry({
        width: w,
        height: h,
        minWidth: PANEL_EXPANDED_MIN_WIDTH,
        minHeight: PANEL_EXPANDED_MIN_HEIGHT,
        maxWidth: PANEL_MAX_WIDTH,
        maxHeight: PANEL_MAX_HEIGHT,
        cacheExpandedSize: true,
      })
        .then(() => {
          void placeWindowForPanelState(w, h, "center", "panel-opened").catch((error) => {
            console.warn("[toolbar] panel-opened center placement failed", error);
          });
          console.log("[toolbar] panel-opened → default expanded size", { width: w, height: h });
          lastWindowSizeRef.current = "";
          syncFrameToWindowRef.current();
        })
        .catch((error) => {
          console.warn("[toolbar] panel-opened size/placement failed", error);
        });
      void getSettings()
        .then((next) => {
          setSettings(next);
          setZorderMode(next.panel_zorder_mode ?? "default");
          console.log("[toolbar] panel-opened: settings refreshed", next.provider, next.model);
        })
        .catch((error) => console.warn("[toolbar] panel-opened getSettings failed", error));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [applyPanelGeometry, clearWorkSessionKeepExpanded, placeWindowForPanelState]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("settings-changed", () => {
      void getSettings()
        .then((next) => {
          setSettings(next);
          setZorderMode(next.panel_zorder_mode ?? "default");
          const q = next.queue ?? defaultQueueSettings();
          historyMaxRef.current = clampQueueSize(q.max_queue_size);
          setHistoryItems(readInputHistory(historyMaxRef.current));
          // If default command changed and current cmd is empty/invalid, adopt it.
          setCmdId((prev) => {
            if (prev && cmds.some((c) => c.id === prev)) return prev;
            return resolveDefaultCommandId(cmds, q.default_command_id);
          });
          console.log("[toolbar] settings-changed: panel synced", {
            provider: next.provider,
            model: next.model,
            queue: q,
          });
        })
        .catch((error) => console.warn("[toolbar] settings-changed getSettings failed", error));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [cmds]);

  // When unified_command is on, keep all pending items on the panel's current command.
  useEffect(() => {
    const q = settings?.queue;
    if (!q?.unified_command || !cmdId) return;
    const title = cmds.find((c) => c.id === cmdId)?.title ?? null;
    setQueue((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.status !== "pending" || item.commandId === cmdId) return item;
        changed = true;
        return { ...item, commandId: cmdId, commandTitle: title };
      });
      if (!changed) return prev;
      writeProcessQueue(next, q.persist_queue, q.max_queue_size);
      console.log("[toolbar] unified_command synced pending items to", cmdId);
      return next;
    });
  }, [cmdId, cmds, settings?.queue?.unified_command, settings?.queue?.persist_queue, settings?.queue?.max_queue_size]);

  useEffect(() => {
    // Queue-driven runs never auto-inject; user reviews via history + click-to-copy.
    if (fromQueueRef.current) {
      console.log("[toolbar] skip auto-inject — queue-driven run");
      return;
    }
    if (phase !== "review" || !resultText.trim() || !settings?.auto_inject_enabled) return;
    void setPendingInjectText(resultText).catch((error) => {
      console.warn("[toolbar] setPendingInjectText failed", error);
    });
  }, [resultText, phase, settings?.auto_inject_enabled]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("inject-finished", () => {
      resetSession();
      void collapseWindowToBottomRight("inject-finished").catch((error) => {
        console.warn("[toolbar] inject-finished collapse window failed", error);
      });
      console.log("[toolbar] inject-finished → session reset");
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [collapseWindowToBottomRight, resetSession]);

  const stepCommand = useCallback(
    (step: 1 | -1) => {
      if (!cmds.length) return;
      const currentIndex = cmds.findIndex((cmd) => cmd.id === cmdId);
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (safeIndex + step + cmds.length) % cmds.length;
      const nextCmd = cmds[nextIndex];
      setCmdId(nextCmd.id);
      console.log("[toolbar] switch command", { from: cmdId || "(none)", to: nextCmd.id, step });
    },
    [cmdId, cmds],
  );

  useEffect(() => {
    if (!historyOpen && !queueOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!historyRowRef.current?.contains(target)) {
        if (historyOpen) {
          setHistoryOpen(false);
          console.log("[toolbar] close input history popover");
        }
        if (queueOpen) {
          setQueueOpen(false);
          console.log("[toolbar] close queue popover");
        }
      }
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [historyOpen, queueOpen]);

  useEffect(() => {
    if (!commandOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!railRef.current?.contains(target)) {
        setCommandOpen(false);
        console.log("[toolbar] close command panel by outside click");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCommandOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [commandOpen]);

  useEffect(() => {
    void applyPanelGeometry({
      width: EXPANDED_PANEL_WIDTH,
      height: EXPANDED_PRESET_HEIGHT,
      minWidth: PANEL_EXPANDED_MIN_WIDTH,
      minHeight: PANEL_EXPANDED_MIN_HEIGHT,
      maxWidth: PANEL_MAX_WIDTH,
      maxHeight: PANEL_MAX_HEIGHT,
    }).catch((error) => {
      console.warn("[toolbar] failed to set panel size bounds", error);
    });
  }, [applyPanelGeometry]);

  useEffect(() => {
    if (expanded) focusEditor();
  }, [expanded, focusEditor]);

  const selectedCmd = cmds.find((cmd) => cmd.id === cmdId);
  const commandDescription = useMemo(() => getCommandDescription(selectedCmd, locale), [selectedCmd, locale]);
  const providerHint = useMemo(() => (settings ? formatProviderChip(settings, locale) : ""), [settings, locale]);
  const competitionTags = useMemo(
    () => (settings ? competitionPanelTags(settings) : []),
    [settings],
  );

  const pendingQueueCount = queue.filter((x) => x.status === "pending").length;
  const runningQueueItem = queue.find((x) => x.status === "running") ?? null;
  const runningQueueCount = runningQueueItem ? 1 : 0;
  const errorQueueCount = queue.filter((x) => x.status === "error").length;
  const canStartQueue = pendingQueueCount > 0 || errorQueueCount > 0 || runningQueueCount > 0;

  const historyMax = clampQueueSize(settings?.queue?.max_queue_size ?? 10);
  const queueEnabled = settings?.queue?.enabled ?? true;
  const unifiedCommand = settings?.queue?.unified_command ?? true;

  const statusLabel =
    phase === "running"
      ? runningQueueItem
        ? copy.statusRunning(runningQueueItem.seq)
        : copy.statusRunningPlain
      : phase === "review"
        ? copy.statusCopy
        : phase === "error"
          ? copy.statusFailed
          : inputText.trim()
            ? copy.statusTyped
            : copy.statusIdle;

  // While streaming, lock the left pane so the shown 原文 is not edited mid-run.
  // Between queue items (review/idle) the user can edit and enqueue more.
  const inputReadOnly = phase === "running";

  const expandPanelToCenter = useCallback(
    async (openCommand: boolean, reason: string) => {
      pendingPlacementRef.current = "center";
      lastWindowSizeRef.current = "";

      // Commit the expanded layout synchronously, then size the window to the default
      // 1280×400 and center it. Width stays fixed; the layout effect refines height only.
      flushSync(() => {
        setExpanded(true);
        setCommandOpen(openCommand);
      });

      const w = EXPANDED_PANEL_WIDTH;
      const h = EXPANDED_PRESET_HEIGHT;

      try {
        await applyPanelGeometry({
          width: w,
          height: h,
          minWidth: PANEL_EXPANDED_MIN_WIDTH,
          minHeight: PANEL_EXPANDED_MIN_HEIGHT,
          maxWidth: PANEL_MAX_WIDTH,
          maxHeight: PANEL_MAX_HEIGHT,
          cacheExpandedSize: true,
        });
        await placeWindowForPanelState(w, h, "center", `${reason}-expanded`);
        console.log("[toolbar] expand panel default size", {
          reason,
          width: w,
          height: h,
          openCommand,
        });
      } catch (error) {
        console.warn("[toolbar] expand size/placement failed", { reason, error });
      }
      void getSettings()
        .then((next) => {
          setSettings(next);
          console.log("[toolbar] expand panel: settings refreshed", next.provider, next.model);
        })
        .catch((error) => console.warn("[toolbar] expand getSettings failed", error));
      console.log("[toolbar] expand input panel", { reason, commandOpen: openCommand });
    },
    [applyPanelGeometry, placeWindowForPanelState],
  );

  const openInputPanel = useCallback(() => {
    if (expanded) {
      flushSync(() => {
        setExpanded(false);
        setCommandOpen(false);
      });
      void collapseWindowToBottomRight("input-toggle-collapse").catch((error) => {
        console.warn("[toolbar] collapse bottom-right failed", error);
      });
      console.log("[toolbar] collapse input panel (input icon toggle)");
      return;
    }
    void expandPanelToCenter(false, "input-toggle-expand");
  }, [collapseWindowToBottomRight, expanded, expandPanelToCenter]);

  const toggleCommandPanel = useCallback(() => {
    if (!expanded) {
      void expandPanelToCenter(true, "command-toggle-from-collapsed");
      return;
    }
    setCommandOpen((prev) => {
      const next = !prev;
      console.log("[toolbar] toggle command panel", next);
      return next;
    });
  }, [expanded, expandPanelToCenter]);

  const cycleStylePreset = useCallback(() => {
    setStylePreset((prev) => {
      const next = getNextStylePreset(prev);
      writeMenuStylePreset(next);
      console.log("[toolbar] cycle menu style preset", next);
      return next;
    });
  }, []);

  const zorderLabel = useMemo(() => {
    switch (zorderMode) {
      case "default":
        return m.zorder.default;
      case "upper":
        return m.zorder.upper;
      case "always_top":
        return m.zorder.alwaysTop;
    }
  }, [zorderMode, m]);

  const cycleZorderMode = useCallback(async () => {
    const order: PanelZorderMode[] = ["default", "upper", "always_top"];
    const idx = order.indexOf(zorderMode);
    const next = order[(idx + 1) % order.length];
    setZorderMode(next);
    await setPanelZorderMode(next).catch((error) => {
      console.warn("[toolbar] set zorder mode failed", error);
    });
    console.log("[toolbar] zorder cycled", { from: zorderMode, to: next });
  }, [zorderMode]);

  const copyResultToClipboard = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? resultText).trim();
    if (!text) return;
    // Only select the result DOM node when copying the currently displayed result.
    if (!textOverride) {
      const el = resultAreaRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    try {
      await copyToClipboard(text);
      setCopiedFlash(true);
      window.setTimeout(() => setCopiedFlash(false), 1200);
      console.log("[toolbar] result copied", { len: text.length, fromHistory: Boolean(textOverride) });
    } catch (error) {
      console.warn("[toolbar] result copy failed", error);
    }
  }, [resultText]);

  /** Pointer-up copy: on Win/WebView2 shell drag (pointerdown) can swallow onClick in split mode. */
  const onResultPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (phase !== "review" || !resultText.trim()) return;
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      void copyResultToClipboard();
    },
    [copyResultToClipboard, phase, resultText],
  );

  const onResultKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (phase !== "review" || !resultText.trim()) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      void copyResultToClipboard();
    },
    [copyResultToClipboard, phase, resultText],
  );

  const openSettingsWorkspace = useCallback(async () => {
    try {
      await showSettingsCmd();
      console.log("[toolbar] open settings: invoke ok (backend defers hide + main window to next UI tick)");
    } catch (error) {
      setErrorMsg(String(error));
      setPhase("error");
      setExpanded(true);
      queueMicrotask(() => syncFrameToWindowRef.current());
    }
  }, []);

  /** Open a main-window route from the expanded rail (统计 / 关于) while the floating panel remains visible but non-blocking. */
  const openWorkspacePageFromPanel = useCallback(async (slug: string) => {
    try {
      await showWorkspacePageCmd(slug);
      console.log("[toolbar] open workspace page from panel while panel stays visible", { slug });
    } catch (error) {
      setErrorMsg(String(error));
      setPhase("error");
      setExpanded(true);
      queueMicrotask(() => syncFrameToWindowRef.current());
      console.error("[toolbar] open workspace page failed", error);
    }
  }, []);

  /** Ctrl+Enter: always a single immediate run (never enqueue). */
  const submitRun = useCallback(() => {
    if (!cmdId || busy || phase === "running") return;
    console.log("[toolbar] Ctrl+Enter single submit", {
      cmdId,
      inputLen: inputText.trim().length,
    });
    void runLlmJob(inputText);
  }, [busy, cmdId, inputText, phase, runLlmJob]);

  const removeQueueItem = useCallback(
    (id: string) => {
      setQueue((prev) => {
        const target = prev.find((x) => x.id === id);
        if (target?.status === "running") {
          console.warn("[toolbar] cannot remove running queue item", id);
          return prev;
        }
        const next = prev.filter((x) => x.id !== id);
        persistQueueState(next);
        console.log("[toolbar] queue item removed", id);
        return next;
      });
      queueMicrotask(() => syncFrameToWindowRef.current());
    },
    [persistQueueState],
  );

  const clearFinishedQueue = useCallback(() => {
    setQueue((prev) => {
      const next = prev.filter((x) => x.status === "pending" || x.status === "running" || x.status === "error");
      persistQueueState(next, true);
      console.log("[toolbar] cleared finished queue items", {
        before: prev.length,
        after: next.length,
      });
      return next;
    });
    queueMicrotask(() => syncFrameToWindowRef.current());
  }, [persistQueueState]);

  const clearAllQueue = useCallback(() => {
    if (busy || queueWorkerBusyRef.current) {
      console.warn("[toolbar] clearAllQueue ignored — worker busy");
      setErrorMsg(catalogs.zh.panel.stopBeforeClear);
      setPhase("error");
      return;
    }
    setQueue([]);
    persistQueueState([], true);
    console.log("[toolbar] queue cleared");
    queueMicrotask(() => syncFrameToWindowRef.current());
  }, [busy, persistQueueState]);

  const updateQueueItemCommand = useCallback(
    (id: string, nextCommandId: string) => {
      const title = cmds.find((c) => c.id === nextCommandId)?.title ?? null;
      setQueue((prev) => {
        const next = prev.map((item) =>
          item.id === id && item.status === "pending"
            ? { ...item, commandId: nextCommandId, commandTitle: title }
            : item,
        );
        persistQueueState(next);
        console.log("[toolbar] queue item command updated", { id, nextCommandId });
        return next;
      });
    },
    [cmds, persistQueueState],
  );

  const prefillFromQueueItem = useCallback((item: QueueItem) => {
    if (item.status === "running") return;
    setInputText(`${item.seq}. ${item.input}`);
    // Show this item's result with its Arabic numeral; keep blank line friendly for paste.
    setResultText(item.result?.trim() ? `${item.seq}. ${item.result.trim()}` : "");
    setCmdId(item.commandId);
    setErrorMsg(item.error ?? null);
    setPhase(item.result?.trim() ? "review" : item.error ? "error" : "idle");
    setCopiedFlash(false);
    console.log("[toolbar] prefilled editor from queue item", {
      id: item.id,
      seq: item.seq,
      status: item.status,
    });
  }, []);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (inputText.trim() || resultText.trim() || phase === "review" || phase === "error") {
        resetSession();
        void collapseWindowToBottomRight("escape-reset-session").catch((error) => {
          console.warn("[toolbar] escape reset collapse window failed", error);
        });
      } else {
        flushSync(() => {
          setExpanded(false);
          setCommandOpen(false);
        });
        void collapseWindowToBottomRight("escape-collapse-empty").catch((error) => {
          console.warn("[toolbar] escape collapse window failed", error);
        });
      }
      return;
    }
    if (event.nativeEvent.isComposing) return;
    if (phase === "idle" || phase === "error") {
      // 单独 ↑/↓：在首行按 ↑ 上一条、末行按 ↓ 下一条（多行时中间行仍用于移动光标）。
      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        const caret = event.currentTarget.selectionStart ?? 0;
        const line = lineIndexAtCaret(inputText, caret);
        const lines = totalLineCount(inputText);
        if (event.key === "ArrowUp" && line === 0) {
          event.preventDefault();
          stepCommand(-1);
          return;
        }
        if (event.key === "ArrowDown" && line === lines - 1) {
          event.preventDefault();
          stepCommand(1);
          return;
        }
      }
    }
    // Ctrl+Enter is single-submit only; block while a run is in flight.
    if (phase === "running") return;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitRun();
    }
  };

  useLayoutEffect(() => {
    if (expanded && !prevExpandedRef.current) {
      lastWindowSizeRef.current = "";
    }
    prevExpandedRef.current = expanded;
  }, [expanded]);

  // Whether the result pane is shown side-by-side with the input (split layout).
  const showResultPanel = phase === "running" || phase === "review";

  /**
   * Sync the native window size to the panel state. Runs after DOM commit so the mirror
   * measurements (and the collapsed root border-box) are accurate.
   * - Expanded: syncFrameToWindow measures hidden mirrors of the input/result and setSize()
   * - Expanded: width fixed at 1280; height auto-grows with wrapped content [400,720].
   * - Collapsed: syncFrameToWindow measures the root border box and setSize() so the window
   *   wraps the tiny 4-icon toolbar exactly — no transparent bottom layer.
   */
  useLayoutEffect(() => {
    if (!frameRef.current) return;
    syncFrameToWindow();
  }, [commandOpen, cmds.length, errorMsg, expanded, inputText, phase, resultText, stylePreset, zorderMode, copiedFlash, locale, syncFrameToWindow]);

  const onShellPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, textarea, input, select, [data-no-window-drag='true']")) return;
    void getCurrentWindow().startDragging().catch((error) => {
      console.warn("[toolbar] start dragging failed", error);
    });
  }, []);

  return (
    <main
      ref={frameRef}
      className={`ime-panel-root${expanded ? " ime-panel-root--expanded" : ""}`}
      aria-label={copy.toolbar}
    >
      <div
        ref={shellRef}
        className={`ime-panel-shell${expanded ? " ime-panel-shell--expanded" : " ime-panel-shell--collapsed"}`}
        data-style-preset={stylePreset}
        data-tauri-drag-region
        onPointerDown={onShellPointerDown}
      >
        <div className={`ime-panel-layout${expanded ? " ime-panel-layout--expanded" : " ime-panel-layout--collapsed"}`}>
          <div
            ref={railRef}
            className={`ime-rail-anchor${
              commandOpen
                ? expanded
                  ? " ime-rail-anchor--command-open ime-rail-anchor--command-open-expanded"
                  : " ime-rail-anchor--command-open ime-rail-anchor--command-open-collapsed"
                : ""
            }`}
          >
            <section className={`ime-primary-rail${expanded ? " ime-primary-rail--vertical" : " ime-primary-rail--horizontal"}`}>
              <div className="ime-rail-cluster ime-rail-cluster--main">
                <button
                  type="button"
                  className={`ime-icon-btn${expanded ? " ime-icon-btn--active" : ""}`}
                  data-tauri-drag-region="false"
                  onClick={openInputPanel}
                  title={expanded ? copy.collapseInput : copy.expandInput}
                  aria-label={expanded ? copy.collapseInput : copy.expandInput}
                >
                  <span aria-hidden="true">⌨</span>
                </button>

                <button
                  type="button"
                  className={`ime-icon-btn${commandOpen ? " ime-icon-btn--active" : ""}`}
                  data-tauri-drag-region="false"
                  onClick={toggleCommandPanel}
                  title={selectedCmd ? copy.commandTitle(visibleCommandTitle(selectedCmd.id, selectedCmd.title, locale)) : copy.command}
                  aria-label={copy.command}
                >
                  <span aria-hidden="true">⌘</span>
                </button>

                <button
                  type="button"
                  className="ime-icon-btn"
                  data-tauri-drag-region="false"
                  onClick={cycleStylePreset}
                  title={copy.styleTitle(stylePresetLabel(stylePreset, locale))}
                  aria-label={copy.style}
                >
                  <span aria-hidden="true">◐</span>
                </button>

                <button
                  type="button"
                  className="ime-icon-btn"
                  data-tauri-drag-region="false"
                  onClick={() => void openSettingsWorkspace()}
                  title={copy.settings}
                  aria-label={copy.settings}
                >
                  <span aria-hidden="true">⚙</span>
                </button>
              </div>

              {expanded ? (
                <div className="ime-rail-cluster ime-rail-cluster--footer">
                  <button
                    type="button"
                    className="ime-icon-btn"
                    data-tauri-drag-region="false"
                    onClick={() => void openWorkspacePageFromPanel("statistics")}
                    title={copy.stats}
                    aria-label={copy.stats}
                  >
                    <IconStatsOutline />
                  </button>
                  <button
                    type="button"
                    className="ime-icon-btn"
                    data-tauri-drag-region="false"
                    onClick={() => void openWorkspacePageFromPanel("appearance")}
                    title={copy.about}
                    aria-label={copy.about}
                  >
                    <IconInfoOutline />
                  </button>
                </div>
              ) : null}
            </section>

            {commandOpen ? (
              <section
                className={`ime-command-popover${expanded ? " ime-command-popover--expanded" : " ime-command-popover--collapsed"}`}
                data-tauri-drag-region="false"
              >
                <div className="ime-command-popover-head">
                  <div>
                    <p className="ime-command-popover-eyebrow">{copy.activeCommand}</p>
                    <div className="ime-command-current">
                      {selectedCmd ? visibleCommandTitle(selectedCmd.id, selectedCmd.title, locale) : copy.commandWord}
                    </div>
                  </div>
                </div>

                <div className="ime-command-grid">
                  {cmds.map((cmd) => (
                    <button
                      key={cmd.id}
                      type="button"
                      className={`ime-command-chip${cmd.id === cmdId ? " ime-command-chip--active" : ""}`}
                      onClick={() => {
                        setCmdId(cmd.id);
                        setCommandOpen(false);
                        console.log("[toolbar] select command in popup", { cmdId: cmd.id });
                      }}
                      title={visibleCommandTitle(cmd.id, cmd.title, locale)}
                    >
                      <span className="ime-command-chip-label">{getCommandShortLabel(cmd, locale)}</span>
                    </button>
                  ))}
                </div>

                <p className="ime-command-desc">{commandDescription}</p>
              </section>
            ) : null}
          </div>

          {expanded ? (
            <section ref={editorPanelRef} className="ime-editor-panel" data-tauri-drag-region="false">
              {/*
                Editor header: left = status + command + model (inline); right = action cluster.
                Style preset is switched from the rail (◐) — no duplicate style label here.
              */}
              <div className="ime-editor-topline">
                <div className="ime-editor-meta ime-editor-meta--left">
                  {/* Status → command title → model chip sit on one row, model flush after the command. */}
                  <div className="ime-editor-title-row">
                    <span className={`ime-status-badge ime-status-badge--${phase}`}>{statusLabel}</span>
                    <span className="ime-command-name">
                      {selectedCmd ? visibleCommandTitle(selectedCmd.id, selectedCmd.title, locale) : copy.noCommand}
                    </span>
                    {providerHint ? <span className="ime-provider-chip">{providerHint}</span> : null}
                    {competitionTags.length > 0 ? (
                      <div className="ime-competition-tags" aria-label={copy.competition}>
                        {competitionTags.map((tag) => (
                          <span
                            key={tag.id}
                            className={`ime-model-tag${tag.active ? " ime-model-tag--active" : ""}${
                              !tag.enabled ? " ime-model-tag--disabled" : ""
                            }`}
                            title={`${tag.label} · ${tag.model}${tag.active ? copy.activeTag : ""}`}
                          >
                            {tag.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="ime-editor-meta ime-editor-meta--right">
                  <div className="ime-theme-row" ref={historyRowRef} data-tauri-drag-region="false">
                    {queueEnabled ? (
                      <button
                        type="button"
                        className={`ime-history-trigger ime-queue-trigger${queueOpen ? " ime-history-trigger--open" : ""}`}
                        data-tauri-drag-region="false"
                        title={
                          queue.length > 0
                            ? copy.queueCount(pendingQueueCount, runningQueueCount)
                            : copy.queue
                        }
                        aria-label={copy.queue}
                        aria-expanded={queueOpen}
                        onClick={() => {
                          setHistoryOpen(false);
                          setQueueOpen((o) => !o);
                          console.log("[toolbar] toggle queue popover");
                        }}
                      >
                        <IconQueue />
                        {pendingQueueCount + runningQueueCount + errorQueueCount > 0 ? (
                          <span className="ime-queue-badge" aria-hidden="true">
                            {Math.min(99, pendingQueueCount + runningQueueCount + errorQueueCount)}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ime-history-trigger ime-new-task-trigger"
                      data-tauri-drag-region="false"
                      disabled={phase === "running" && !queueEnabled}
                      title={copy.newTask}
                      aria-label={copy.newTaskAria}
                      onClick={() => {
                        startNewTask();
                      }}
                    >
                      <IconNewTask />
                    </button>
                    <button
                      type="button"
                      className={`ime-history-trigger${historyOpen ? " ime-history-trigger--open" : ""}`}
                      data-tauri-drag-region="false"
                      disabled={phase === "running" && !queueEnabled}
                      title={copy.historyTitle(historyMax)}
                      aria-label={copy.history}
                      aria-expanded={historyOpen}
                      onClick={() => {
                        setQueueOpen(false);
                        setHistoryItems(readInputHistory(historyMax));
                        setHistoryOpen((o) => !o);
                        console.log("[toolbar] toggle history popover", { max: historyMax });
                      }}
                    >
                      <IconInputHistory />
                    </button>
                    {/* Pin stays in the action cluster (icon + tooltip); long label no longer wraps into the hint/input gap. */}
                    <button
                      type="button"
                      className={`ime-zorder-chip ime-zorder-chip--${zorderMode} ime-zorder-chip--compact`}
                      data-zorder={zorderMode}
                      data-tauri-drag-region="false"
                      onClick={cycleZorderMode}
                      title={copy.zorderTitle(zorderLabel)}
                      aria-label={copy.zorderAria(zorderLabel)}
                    >
                      <span aria-hidden="true">📌</span>
                    </button>
                    {queueEnabled && queueOpen ? (
                      <div
                        className="ime-queue-popover"
                        role="dialog"
                        aria-label={copy.queue}
                        data-no-window-drag="true"
                        data-tauri-drag-region="false"
                      >
                        <div className="ime-queue-popover-head">
                          <span className="ime-queue-popover-title">{copy.queue}</span>
                          <span className="ime-queue-popover-meta">
                            {queue.length === 0
                              ? copy.emptyBadge
                              : copy.queueBadge(pendingQueueCount, runningQueueCount, errorQueueCount)}
                          </span>
                        </div>
                        <div className="ime-queue-actions">
                          <button
                            type="button"
                            className="btn small secondary"
                            disabled={!inputText.trim()}
                            onClick={() => {
                              enqueueCurrentInput({ start: false, clearInput: true });
                            }}
                            title={copy.enqueueTitle}
                          >
                            {copy.enqueue}
                          </button>
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={!canStartQueue || runningQueueCount > 0}
                            onClick={() => {
                              console.log("[toolbar] manual start queue worker");
                              void processQueueWorkerRef.current();
                            }}
                            title={copy.startTitle}
                          >
                            {copy.start}
                          </button>
                          <button
                            type="button"
                            className="btn small secondary"
                            disabled={!queue.some((x) => x.status === "done" || x.status === "cancelled")}
                            onClick={clearFinishedQueue}
                            title={copy.clearDoneTitle}
                          >
                            {copy.clearDone}
                          </button>
                          <button
                            type="button"
                            className="btn small secondary"
                            disabled={queue.length === 0 || busy}
                            onClick={clearAllQueue}
                            title={copy.clearAllTitle}
                          >
                            {copy.clearAll}
                          </button>
                        </div>
                        {queue.length > 0 ? (
                          <ul className="ime-queue-list" aria-label={copy.queueList}>
                            {queue.map((item, index) => (
                              <li
                                key={item.id}
                                className={`ime-queue-item ime-queue-item--${item.status}`}
                              >
                                <button
                                  type="button"
                                  className="ime-queue-item-main"
                                  onClick={() => prefillFromQueueItem(item)}
                                  title={copy.taskTitle(item.seq)}
                                >
                                  <span className="ime-queue-item-index" aria-label={copy.taskIndex(item.seq)}>
                                    {item.seq}.
                                  </span>
                                  <span className="ime-queue-item-status">{queueStatusLabel(item.status, locale)}</span>
                                  <span className="ime-queue-item-text">{historyPreview(item.input, 48)}</span>
                                </button>
                                {!unifiedCommand && item.status === "pending" ? (
                                  <select
                                    className="ime-queue-item-cmd"
                                    aria-label={copy.rowCommand(index + 1)}
                                    value={item.commandId}
                                    onChange={(e) => updateQueueItemCommand(item.id, e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {cmds.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {visibleCommandTitle(c.id, c.title, locale)}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="ime-queue-item-cmd-label" title={item.commandTitle ?? item.commandId}>
                                    {visibleCommandTitle(item.commandId, item.commandTitle ?? item.commandId, locale)}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  className="ime-queue-item-remove"
                                  disabled={item.status === "running"}
                                  onClick={() => removeQueueItem(item.id)}
                                  aria-label={copy.remove}
                                  title={copy.remove}
                                >
                                  ×
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="ime-queue-empty">{copy.queueEmpty}</p>
                        )}
                      </div>
                    ) : null}
                    {historyOpen ? (
                      <div className="ime-input-history-popover" role="listbox" aria-label={copy.history}>
                        {historyItems.length === 0 ? (
                          <p className="ime-input-history-empty">{copy.historyEmpty(historyMax)}</p>
                        ) : (
                          historyItems.map((entry, i) => (
                            <button
                              key={`${entry.savedAt}-${i}-${entry.input.slice(0, 16)}`}
                              type="button"
                              role="option"
                              className="ime-input-history-item"
                              title={
                                entry.result
                                  ? copy.historyItemTitle(entry.input, entry.result)
                                  : entry.input
                              }
                              onClick={() => {
                                setInputText(entry.input);
                                setResultText(entry.result);
                                setCopiedFlash(false);
                                setErrorMsg(null);
                                setPhase(entry.result.trim() ? "review" : "idle");
                                if (entry.commandId) {
                                  setCmdId(entry.commandId);
                                }
                                setHistoryOpen(false);
                                if (entry.result.trim()) {
                                  // History click: restore for viewing + auto-copy result (no auto-inject).
                                  void copyResultToClipboard(entry.result);
                                  void clearPendingInjectText().catch(() => {});
                                } else {
                                  void clearPendingInjectText().catch(() => {});
                                }
                                console.log("[toolbar] restored history entry", {
                                  index: i,
                                  inputLen: entry.input.length,
                                  resultLen: entry.result.length,
                                  commandId: entry.commandId,
                                  autoCopied: Boolean(entry.result.trim()),
                                });
                              }}
                            >
                              {entry.commandTitle ? (
                                <span className="ime-history-item-cmd">
                                  {entry.commandId
                                    ? visibleCommandTitle(entry.commandId, entry.commandTitle, locale)
                                    : entry.commandTitle}
                                </span>
                              ) : null}
                              <span className="ime-history-item-label">{copy.historyInput}</span>
                              <span className="ime-history-item-text">{historyPreview(entry.input, 72)}</span>
                              {entry.result ? (
                                <>
                                  <span className="ime-history-item-label">{copy.historyResult}</span>
                                  <span className="ime-history-item-text ime-history-item-text--result">
                                    {historyPreview(entry.result, 72)}
                                  </span>
                                </>
                              ) : (
                                <span className="ime-history-item-draft">{copy.historyDraft}</span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <p className="ime-editor-hint">{commandDescription}</p>

              <div
                ref={editorBodyRef}
                // data-no-window-drag: clicking inside the editor body (input or result) must
                // NOT start a window drag — otherwise pointerdown on the result area calls
                // startDragging() and swallows the click, breaking click-to-copy.
                data-no-window-drag="true"
                data-tauri-drag-region="false"
                className={`ime-editor-body${showResultPanel ? " ime-editor-body--split" : ""}`}
              >
                <textarea
                  ref={inputTextareaRef}
                  className="ime-input-area"
                  data-tauri-drag-region="false"
                  readOnly={inputReadOnly}
                  value={inputText}
                  onChange={(event) => {
                    // Only block edits while streaming in single-run mode.
                    // Queue mode keeps the input editable so the user can prefill more items.
                    if (phase === "running" && !queueEnabled) return;
                    setInputText(event.target.value);
                    if (phase === "error") {
                      setErrorMsg(null);
                      setPhase("idle");
                    }
                  }}
                  onKeyDown={onInputKeyDown}
                  placeholder={
                    phase === "running"
                      ? runningQueueItem
                        ? copy.processingSource(runningQueueItem.seq)
                        : copy.processingLocked
                      : showResultPanel
                        ? copy.editHint
                        : copy.inputHint
                  }
                  aria-label={copy.inputAria}
                  title={inputText}
                  spellCheck={false}
                />

                {showResultPanel ? (
                  <div
                    ref={resultAreaRef}
                    className={`ime-result-area ime-result-area--${phase}`}
                    data-tauri-drag-region="false"
                    // data-no-window-drag: clicking the result area to copy must NOT trigger
                    // the shell's window-drag handler (startDragging swallows the click on Win).
                    data-no-window-drag="true"
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={phase === "review" ? onResultPointerUp : undefined}
                    onKeyDown={phase === "review" ? onResultKeyDown : undefined}
                    role={phase === "review" ? "button" : undefined}
                    aria-label={phase === "review" ? copy.copyResultAria : undefined}
                    title={phase === "review" ? copy.copyResultTitle : undefined}
                    tabIndex={phase === "review" ? 0 : -1}
                  >
                    {phase === "running" ? (
                      <pre className="ime-result-text ime-result-text--streaming">{resultText || copy.streaming}</pre>
                    ) : (
                      <>
                        <pre className="ime-result-text">{resultText}</pre>
                        {copiedFlash ? <span className="ime-result-toast" aria-live="polite">{copy.copied}</span> : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>

              {errorMsg ? (
                <div className="ime-feedback ime-feedback--error" role="alert">
                  {presentRuntimeText(errorMsg, locale)}
                </div>
              ) : (
                <div className="ime-feedback">
                  {phase === "running" && busy ? (
                    <button
                      type="button"
                      className="btn small secondary"
                      onClick={() => {
                        queueStopAfterCancelRef.current = true;
                        void cancelLlmStream()
                          .then(() => console.log("[toolbar] cancelLlmStream invoked"))
                          .catch((e) => console.warn("[toolbar] cancelLlmStream failed", e));
                      }}
                    >
                      {copy.stop}
                    </button>
                  ) : null}
                  <span>{copy.submitHint}</span>
                  <span>{copy.summonHint(shortcutDisplayLabel(settings?.global_shortcut, "ctrl+shift+space"))}</span>
                  <span>{copy.switchHint}</span>
                  {settings?.auto_inject_enabled && !queueEnabled ? (
                    <span>{copy.injectHint(shortcutDisplayLabel(settings?.inject_global_shortcut, "ctrl+shift+i"))}</span>
                  ) : (
                    <span>{copy.historyCopyHint}</span>
                  )}
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
      {createPortal(
        <>
          <div
            ref={inputMirrorRef}
            className="ime-measure-mirror ime-measure-mirror--input"
            aria-hidden="true"
          />
          <div
            ref={resultMirrorRef}
            className="ime-measure-mirror ime-measure-mirror--result"
            aria-hidden="true"
          />
        </>,
        document.body,
      )}
    </main>
  );
}
