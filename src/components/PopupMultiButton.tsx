import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PopupButtonItem = {
  id: string;
  label: string;
  title?: string;
  selected?: boolean;
  disabled?: boolean;
  tone?: "default" | "accent" | "success" | "warning";
};

type PopupMoveSource = "hover" | "click" | "keyboard" | "release";

type Props = {
  triggerIcon?: string;
  triggerLabel: string;
  triggerTitle?: string;
  popupLabel: string;
  items: PopupButtonItem[];
  activeId?: string | null;
  disabled?: boolean;
  mode?: "selection" | "action";
  onActiveChange?: (id: string, source: PopupMoveSource) => void;
  onAction?: (id: string, source: PopupMoveSource) => void;
};

const HOLD_CLICK_GUARD_MS = 120;

function isMovePrevKey(key: string): boolean {
  return key === "w" || key === "W" || key === "ArrowUp";
}

function isMoveNextKey(key: string): boolean {
  return key === "s" || key === "S" || key === "ArrowDown";
}

function findNextEnabled(items: PopupButtonItem[], fromId: string | null | undefined, step: 1 | -1): string {
  if (!items.length) return "";
  const enabled = items.filter((item) => !item.disabled);
  if (!enabled.length) return "";
  const currentIndex = enabled.findIndex((item) => item.id === fromId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + step + enabled.length) % enabled.length;
  return enabled[nextIndex]?.id ?? enabled[0].id;
}

/**
 * Compact toolbar popup button:
 * - Pointer press opens the popup immediately so it behaves like an IME candidate switcher.
 * - Releasing closes it; action popups also execute the highlighted item on release.
 * - W / S and ArrowUp / ArrowDown move the highlighted option while the popup is open.
 */
export function PopupMultiButton({
  triggerIcon,
  triggerLabel,
  triggerTitle,
  popupLabel,
  items,
  activeId,
  disabled = false,
  mode = "selection",
  onActiveChange,
  onAction,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const holdOpenRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [focusedId, setFocusedId] = useState("");

  const firstEnabledId = useMemo(() => items.find((item) => !item.disabled)?.id ?? "", [items]);

  const syncFocused = useCallback(
    (nextId?: string | null) => {
      const resolved = nextId && items.some((item) => item.id === nextId && !item.disabled) ? nextId : firstEnabledId;
      setFocusedId(resolved ?? "");
      return resolved ?? "";
    },
    [firstEnabledId, items],
  );

  useEffect(() => {
    if (!open && focusedId) return;
    syncFocused(activeId);
  }, [activeId, focusedId, open, syncFocused]);

  const closePopup = useCallback(() => {
    holdOpenRef.current = false;
    setOpen(false);
  }, []);

  const applySelection = useCallback(
    (nextId: string, source: PopupMoveSource) => {
      if (!nextId) return;
      setFocusedId(nextId);
      if (mode === "selection") {
        console.log("[popup] selection move", { popupLabel, nextId, source });
        onActiveChange?.(nextId, source);
      }
    },
    [mode, onActiveChange, popupLabel],
  );

  const commitAction = useCallback(
    (nextId: string, source: PopupMoveSource) => {
      if (!nextId) return;
      setFocusedId(nextId);
      if (mode === "selection") {
        console.log("[popup] selection commit", { popupLabel, nextId, source });
        onActiveChange?.(nextId, source);
        closePopup();
        return;
      }
      console.log("[popup] action commit", { popupLabel, nextId, source });
      onAction?.(nextId, source);
      closePopup();
    },
    [closePopup, mode, onAction, onActiveChange, popupLabel],
  );

  const openPopup = useCallback(
    (holdOpen: boolean) => {
      if (disabled || !firstEnabledId) return;
      holdOpenRef.current = holdOpen;
      syncFocused(activeId);
      setOpen(true);
      console.log("[popup] open", { popupLabel, holdOpen, activeId });
    },
    [activeId, disabled, firstEnabledId, popupLabel, syncFocused],
  );

  useEffect(() => {
    if (!open) return;

    const onPointerUp = () => {
      if (!holdOpenRef.current) return;
      holdOpenRef.current = false;
      if (mode === "action") {
        const nextId = focusedId || syncFocused(activeId);
        if (nextId) {
          commitAction(nextId, "release");
          return;
        }
      }
      console.log("[popup] close on release", { popupLabel });
      setOpen(false);
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, HOLD_CLICK_GUARD_MS);
    };

    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) {
        closePopup();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isMovePrevKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const nextId = findNextEnabled(items, focusedId || activeId || firstEnabledId, -1);
        applySelection(nextId, "keyboard");
        return;
      }
      if (isMoveNextKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const nextId = findNextEnabled(items, focusedId || activeId || firstEnabledId, 1);
        applySelection(nextId, "keyboard");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePopup();
        return;
      }
      if (event.key === "Enter" && mode === "action") {
        event.preventDefault();
        event.stopPropagation();
        const nextId = focusedId || syncFocused(activeId);
        if (nextId) commitAction(nextId, "keyboard");
      }
    };

    window.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("mousedown", onDocMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("mousedown", onDocMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    activeId,
    applySelection,
    closePopup,
    commitAction,
    firstEnabledId,
    focusedId,
    items,
    mode,
    popupLabel,
    syncFocused,
  ]);

  return (
    <div className="popup-multi-wrap" ref={rootRef} data-tauri-drag-region="false">
      <button
        type="button"
        className="popup-multi-trigger"
        data-tauri-drag-region="false"
        title={triggerTitle}
        aria-label={popupLabel}
        aria-expanded={open}
        aria-haspopup={mode === "selection" ? "listbox" : "menu"}
        disabled={disabled || !firstEnabledId}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          suppressNextClickRef.current = true;
          openPopup(true);
        }}
        onClick={(event) => {
          if (suppressNextClickRef.current) {
            event.preventDefault();
            window.setTimeout(() => {
              suppressNextClickRef.current = false;
            }, HOLD_CLICK_GUARD_MS);
            return;
          }
          if (open) {
            closePopup();
            return;
          }
          openPopup(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) {
              closePopup();
            } else {
              openPopup(false);
            }
          }
        }}
      >
        {triggerIcon ? (
          <span className="popup-multi-trigger-icon" aria-hidden="true">
            {triggerIcon}
          </span>
        ) : null}
        <span className="popup-multi-trigger-label">{triggerLabel}</span>
      </button>

      {open ? (
        <div
          className="popup-multi-panel"
          role={mode === "selection" ? "listbox" : "menu"}
          aria-label={popupLabel}
          data-tauri-drag-region="false"
        >
          {items.map((item) => {
            const active = item.id === focusedId;
            const classes = ["popup-multi-item"];
            if (active) classes.push("popup-multi-item--active");
            if (item.selected) classes.push("popup-multi-item--selected");
            if (item.tone && item.tone !== "default") classes.push(`popup-multi-item--${item.tone}`);
            return (
              <button
                key={item.id}
                type="button"
                role={mode === "selection" ? "option" : "menuitem"}
                className={classes.join(" ")}
                title={item.title}
                aria-selected={mode === "selection" ? item.selected || active : undefined}
                disabled={item.disabled}
                data-tauri-drag-region="false"
                onMouseEnter={() => applySelection(item.id, "hover")}
                onFocus={() => applySelection(item.id, "keyboard")}
                onClick={() => commitAction(item.id, "click")}
              >
                <span className="popup-multi-item-label">{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
