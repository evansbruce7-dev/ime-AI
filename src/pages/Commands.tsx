import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  getUserCommands,
  listDefaultCommands,
  saveUserCommands,
  type PromptCommand,
} from "../api";
import { PageIntro } from "../components/settings/PageIntro";
import { useI18n } from "../i18n/context";
import { formatShownError } from "../lib/llmErrors";
import { visibleCommandTitle } from "./panel/panelCommandMeta";

type UserCommandDraft = PromptCommand & {
  draftKey: string;
};

type DisplayCommand = PromptCommand & {
  key: string;
  editable: boolean;
  draftKey?: string;
};

let userDraftSeed = 0;

const emptyCmd = (): PromptCommand => ({
  id: "",
  title: "",
  prompt: "",
});

const nextDraftKey = (): string => {
  userDraftSeed += 1;
  return `draft_${Date.now()}_${userDraftSeed}`;
};

const createUserDraft = (cmd: PromptCommand): UserCommandDraft => ({
  ...cmd,
  draftKey: nextDraftKey(),
});

const createNewCommandDraft = (title: string, prompt: string): UserCommandDraft =>
  createUserDraft({
    ...emptyCmd(),
    id: `user_${Date.now()}`,
    title,
    prompt,
  });

const toPersistedCommands = (cmds: UserCommandDraft[]): PromptCommand[] =>
  cmds
    .filter((cmd) => cmd.id.trim() && cmd.title.trim())
    .map(({ draftKey: _draftKey, ...cmd }) => cmd);

/**
 * Build the live left-side list from immutable defaults plus current user drafts,
 * so typing into id/title fields updates the list immediately without losing selection.
 */
const buildDisplayCommands = (
  defaultCmds: PromptCommand[],
  userCmds: UserCommandDraft[],
): DisplayCommand[] => {
  const items: DisplayCommand[] = defaultCmds.map((cmd) => ({
    ...cmd,
    key: `builtin:${cmd.id}`,
    editable: false,
  }));
  const indexByMergeId = new Map(items.map((item, index) => [item.id, index]));

  userCmds.forEach((cmd) => {
    const mergeId = cmd.id.trim() || `__draft__${cmd.draftKey}`;
    const userItem: DisplayCommand = {
      id: cmd.id,
      title: cmd.title,
      prompt: cmd.prompt,
      key: `user:${cmd.draftKey}`,
      editable: true,
      draftKey: cmd.draftKey,
    };
    const existingIndex = indexByMergeId.get(mergeId);
    if (typeof existingIndex === "number") {
      items[existingIndex] = userItem;
      return;
    }
    indexByMergeId.set(mergeId, items.length);
    items.push(userItem);
  });

  return items;
};

/** Drop stale keys and append any new rows so `listOrder` always matches the merged list. */
const normalizeListOrderKeys = (lo: string[], display: DisplayCommand[]): string[] => {
  const valid = new Set(display.map((c) => c.key));
  const seen = new Set<string>();
  const next: string[] = [];
  for (const k of lo) {
    if (valid.has(k) && !seen.has(k)) {
      next.push(k);
      seen.add(k);
    }
  }
  for (const c of display) {
    if (!seen.has(c.key)) {
      next.push(c.key);
      seen.add(c.key);
    }
  }
  return next;
};

/** Map persisted merged `id` order (from disk) to stable row keys used in the UI. */
const persistedIdsToKeys = (orderIds: string[], display: DisplayCommand[]): string[] => {
  const out: string[] = [];
  const used = new Set<string>();
  for (const id of orderIds) {
    const row = display.find((c) => c.id === id);
    if (row && !used.has(row.key)) {
      out.push(row.key);
      used.add(row.key);
    }
  }
  for (const c of display) {
    if (!used.has(c.key)) {
      out.push(c.key);
      used.add(c.key);
    }
  }
  return out;
};

/** Convert UI row keys to merged `id` values for `user_commands.json` → `order`. */
const keysToPersistedOrderIds = (orderKeys: string[], userRows: UserCommandDraft[]): string[] =>
  orderKeys
    .map((key) => {
      if (key.startsWith("builtin:")) return key.slice("builtin:".length);
      if (key.startsWith("user:")) {
        const dk = key.slice("user:".length);
        const u = userRows.find((x) => x.draftKey === dk);
        return u?.id.trim() ?? "";
      }
      return "";
    })
    .filter((id) => id.length > 0);

const reorderKeys = (list: string[], fromKey: string, toKey: string): string[] => {
  const fi = list.indexOf(fromKey);
  const ti = list.indexOf(toKey);
  if (fi < 0 || ti < 0 || fi === ti) return list;
  const next = [...list];
  const [item] = next.splice(fi, 1);
  next.splice(ti, 0, item);
  return next;
};

const pickSelectedKey = (
  commands: DisplayCommand[],
  currentKey: string,
  preferredId?: string,
): string => {
  if (preferredId) {
    const preferred = commands.find((cmd) => cmd.id === preferredId);
    if (preferred) return preferred.key;
  }
  if (currentKey && commands.some((cmd) => cmd.key === currentKey)) {
    return currentKey;
  }
  return commands[0]?.key ?? "";
};

export function CommandsPage() {
  const { locale, m } = useI18n();
  const copy = m.commands;
  const [defaultCmds, setDefaultCmds] = useState<PromptCommand[]>([]);
  const [userCmds, setUserCmds] = useState<UserCommandDraft[]>([]);
  const [listOrder, setListOrder] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** Row key currently under the pointer while dragging (highlight only). */
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  /** Row key whose handle started a pointer-drag (highlight source row). */
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const pointerDragSourceRef = useRef<string | null>(null);

  const load = useCallback(async (preferredId?: string) => {
    setErr(null);
    try {
      const [defaults, snap] = await Promise.all([listDefaultCommands(), getUserCommands()]);
      const drafts = snap.commands.map(createUserDraft);
      const display = buildDisplayCommands(defaults, drafts);
      const initialKeys =
        snap.order.length > 0 ? persistedIdsToKeys(snap.order, display) : display.map((c) => c.key);
      const keys = normalizeListOrderKeys(initialKeys, display);
      setDefaultCmds(defaults);
      setUserCmds(drafts);
      setListOrder(keys);
      setSelectedKey((prev) => pickSelectedKey(display, prev, preferredId));
      console.log(
        "[commands] defaults=",
        defaults.length,
        "user rows=",
        drafts.length,
        "persisted order len=",
        snap.order.length,
        "list keys=",
        keys.length,
      );
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const displayCommands = useMemo(
    () => buildDisplayCommands(defaultCmds, userCmds),
    [defaultCmds, userCmds],
  );

  const displayCommandsRef = useRef(displayCommands);
  displayCommandsRef.current = displayCommands;

  const orderedDisplay = useMemo(() => {
    const byKey = new Map(displayCommands.map((c) => [c.key, c]));
    const seen = new Set<string>();
    const out: DisplayCommand[] = [];
    for (const k of listOrder) {
      const c = byKey.get(k);
      if (c) {
        out.push(c);
        seen.add(k);
      }
    }
    for (const c of displayCommands) {
      if (!seen.has(c.key)) {
        out.push(c);
        seen.add(c.key);
      }
    }
    return out;
  }, [listOrder, displayCommands]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return orderedDisplay;
    return orderedDisplay.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        cmd.id.toLowerCase().includes(q) ||
        cmd.prompt.toLowerCase().includes(q),
    );
  }, [orderedDisplay, filter]);

  const selectedDisplay = displayCommands.find((cmd) => cmd.key === selectedKey) ?? null;
  const selectedUserIndex =
    selectedDisplay?.editable && selectedDisplay.draftKey
      ? userCmds.findIndex((cmd) => cmd.draftKey === selectedDisplay.draftKey)
      : -1;
  const selectedUser = selectedUserIndex >= 0 ? userCmds[selectedUserIndex] : null;
  const selectedDefault =
    selectedDisplay && !selectedDisplay.editable
      ? defaultCmds.find((cmd) => cmd.id === selectedDisplay.id) ?? null
      : null;

  const canReorder = !filter.trim();

  const pickRowKeyUnderPoint = (clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const row = el?.closest("[data-cmd-row-key]");
    return row?.getAttribute("data-cmd-row-key") ?? null;
  };

  const endPointerDragFromHandle = (e: ReactPointerEvent<HTMLSpanElement>, commit: boolean) => {
    const handle = e.currentTarget;
    const from = pointerDragSourceRef.current;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    pointerDragSourceRef.current = null;
    setDraggingKey(null);
    setDragOverKey(null);
    if (!commit || !from) return;
    if (filter.trim()) return;
    const to = pickRowKeyUnderPoint(e.clientX, e.clientY);
    if (!to || from === to) return;
    setListOrder((prev) =>
      reorderKeys(normalizeListOrderKeys(prev, displayCommandsRef.current), from, to),
    );
    setSaved(false);
    console.log("[commands] pointer-reorder", from, "→", to);
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLSpanElement>, rowKey: string) => {
    if (!canReorder || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerDragSourceRef.current = rowKey;
    setDraggingKey(rowKey);
    setDragOverKey(rowKey);
  };

  const onHandlePointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!pointerDragSourceRef.current) return;
    const over = pickRowKeyUnderPoint(e.clientX, e.clientY);
    if (over) setDragOverKey(over);
  };

  const onHandlePointerUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!pointerDragSourceRef.current) return;
    endPointerDragFromHandle(e, true);
  };

  const onHandlePointerCancel = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!pointerDragSourceRef.current) return;
    endPointerDragFromHandle(e, false);
  };

  const ensureUserRow = () => {
    if (!selectedDefault) return;
    const existing = userCmds.find((cmd) => cmd.id === selectedDefault.id);
    if (existing) {
      setSelectedKey(`user:${existing.draftKey}`);
      return;
    }

    const draft = createUserDraft(selectedDefault);
    setUserCmds((prev) => [...prev, draft]);
    setListOrder((prev) =>
      normalizeListOrderKeys(
        prev.map((k) => (k === `builtin:${selectedDefault.id}` ? `user:${draft.draftKey}` : k)),
        buildDisplayCommands(defaultCmds, [...userCmds, draft]),
      ),
    );
    setSelectedKey(`user:${draft.draftKey}`);
    setSaved(false);
    console.log("[commands] created override row for", selectedDefault.id);
  };

  const updateUserField = (field: keyof PromptCommand, value: string) => {
    if (!selectedUser) return;
    const currentDraftKey = selectedUser.draftKey;
    setUserCmds((prev) => {
      const idx = prev.findIndex((cmd) => cmd.draftKey === currentDraftKey);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    setSaved(false);
  };

  const save = async () => {
    setErr(null);
    setSaved(false);
    try {
      const persisted = toPersistedCommands(userCmds);
      const display = buildDisplayCommands(defaultCmds, userCmds);
      const orderIds = keysToPersistedOrderIds(normalizeListOrderKeys(listOrder, display), userCmds);
      await saveUserCommands(persisted, orderIds);
      await load(selectedUser?.id ?? selectedDisplay?.id);
      setSaved(true);
      console.log("[commands] save OK rows=", persisted.length, "order len=", orderIds.length);
    } catch (e) {
      setErr(String(e));
    }
  };

  const addNew = () => {
    const draft = createNewCommandDraft(copy.newTitle, copy.newPrompt);
    setUserCmds((prev) => [...prev, draft]);
    setListOrder((prev) => normalizeListOrderKeys([...prev, `user:${draft.draftKey}`], buildDisplayCommands(defaultCmds, [...userCmds, draft])));
    setSelectedKey(`user:${draft.draftKey}`);
    setSaved(false);
    console.log("[commands] added user command", draft.id);
  };

  const removeSelected = () => {
    if (!selectedUser) return;
    const currentIndex = orderedDisplay.findIndex((cmd) => cmd.key === selectedKey);
    const removedId = selectedUser.id.trim();
    const isBuiltinOverride = removedId.length > 0 && defaultCmds.some((d) => d.id === removedId);
    const nextUserCmds = userCmds.filter((cmd) => cmd.draftKey !== selectedUser.draftKey);
    const nextDisplay = buildDisplayCommands(defaultCmds, nextUserCmds);

    const removedKey = selectedKey;
    setListOrder((prev) => {
      const fromIdx = prev.indexOf(removedKey);
      let next = prev.filter((k) => k !== removedKey);
      if (isBuiltinOverride) {
        const bk = `builtin:${removedId}`;
        if (!next.includes(bk)) {
          const at = Math.min(Math.max(0, fromIdx), next.length);
          next = [...next.slice(0, at), bk, ...next.slice(at)];
        }
      }
      return normalizeListOrderKeys(next, nextDisplay);
    });

    const fallbackSelection =
      nextDisplay.find((cmd) => cmd.id === removedId) ??
      nextDisplay[currentIndex] ??
      nextDisplay[currentIndex - 1] ??
      nextDisplay[0] ??
      null;

    setUserCmds(nextUserCmds);
    setSelectedKey(fallbackSelection?.key ?? "");
    setSaved(false);
    console.log("[commands] removed user command", selectedUser.id, "remaining=", nextUserCmds.length);
  };

  return (
    <div>
      <PageIntro index="03" kicker={copy.kicker} title={copy.title} lede={copy.lede} />

      {saved ? (
        <div className="banner success" role="status">
          {copy.saved}
        </div>
      ) : null}
      {err ? (
        <div className="banner err" role="alert">
          {formatShownError(err, locale)}
        </div>
      ) : null}

      <div className="cmd-editor-layout">
        <div className="cmd-list-side">
          <div className="cmd-list-search">
            <input
              type="search"
              placeholder={copy.searchPlaceholder}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={copy.searchAria}
            />
          </div>
          <div
            className={`cmd-list-scroll${draggingKey ? " cmd-list-scroll--dragging" : ""}`}
            role="listbox"
            aria-label={copy.listAria}
          >
            {filtered.length > 0 ? (
              filtered.map((cmd) => (
                <div
                  key={cmd.key}
                  role="option"
                  data-cmd-row-key={cmd.key}
                  aria-selected={cmd.key === selectedKey}
                  className={`cmd-list-row${cmd.key === selectedKey ? " active" : ""}${dragOverKey === cmd.key ? " drag-over" : ""}${draggingKey === cmd.key ? " cmd-list-row--source" : ""}`}
                >
                  <span
                    className="cmd-drag-handle"
                    onPointerDown={(e) => onHandlePointerDown(e, cmd.key)}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerCancel}
                    title={canReorder ? copy.dragEnabled : copy.dragDisabled}
                    aria-label={copy.dragAria}
                  >
                    ⣿
                  </span>
                  <button
                    type="button"
                    className="cmd-list-item cmd-list-item-main"
                    onClick={() => setSelectedKey(cmd.key)}
                  >
                    {visibleCommandTitle(cmd.id, cmd.title, locale) || copy.untitled}
                    <span className="cmd-list-item-id">{cmd.id || copy.missingId}</span>
                  </button>
                </div>
              ))
            ) : (
              <p className="cmd-list-empty muted small">{copy.empty}</p>
            )}
          </div>
          <div className="cmd-list-actions">
            <button type="button" className="btn secondary small cmd-add-btn" onClick={addNew}>
              {copy.add}
            </button>
          </div>
        </div>

        <div className="cmd-detail-side">
          {!selectedDisplay ? (
            <div className="cmd-empty-state">
              <p className="muted">{copy.pick}</p>
            </div>
          ) : selectedUser ? (
            <>
              <div className="cmd-card-head">
                <label className="field">
                  <span className="field-label">{copy.id}</span>
                  <input
                    className="input-grow"
                    aria-label={copy.idAria}
                    value={selectedUser.id}
                    onChange={(e) => updateUserField("id", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">{copy.name}</span>
                  <input
                    className="input-grow"
                    aria-label={copy.nameAria}
                    value={selectedUser.title}
                    onChange={(e) => updateUserField("title", e.target.value)}
                  />
                </label>
              </div>

              <div className="cmd-inline-actions">
                <button type="button" className="btn secondary small cmd-delete" onClick={removeSelected}>
                  {copy.delete}
                </button>
              </div>

              <label className="field full">
                <span className="field-label">{copy.prompt}</span>
                <textarea
                  rows={10}
                  value={selectedUser.prompt}
                  onChange={(e) => updateUserField("prompt", e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <p className="field-label">{copy.builtin}</p>
              <p className="muted small">
                {selectedDefault ? visibleCommandTitle(selectedDefault.id, selectedDefault.title, locale) : ""}
              </p>
              <textarea readOnly rows={8} value={selectedDefault?.prompt ?? ""} />
              <div className="row">
                <button type="button" className="btn primary" onClick={ensureUserRow}>
                  {copy.customize}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="footer-actions">
        <button type="button" className="btn primary" onClick={() => void save()}>
          {copy.save}
        </button>
      </div>
    </div>
  );
}
