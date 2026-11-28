import { type FileTreeRow, fileTreeRows } from "@nf-builder/engine";
import type { JSX, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef } from "react";
import { FileTree } from "./file-tree";
import { type FilesStatus, filesStore, useFiles } from "./files-store";
import { type TypeAhead, treeKey } from "./tree-keys";
import "./files.css";

const NAV_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Enter",
]);

/** The panel's layout: the tree, or why there isn't one. */
export function FilesPanelView({
  status,
  message,
  rows,
  selected,
  onSelect,
  onActivate,
  onKeyDown,
}: {
  readonly status: FilesStatus;
  readonly message: string | null;
  readonly rows: readonly FileTreeRow[];
  readonly selected: string | null;
  readonly onSelect: (path: string) => void;
  readonly onActivate: (row: FileTreeRow) => void;
  readonly onKeyDown?: (
    event: KeyboardEvent<HTMLUListElement>,
    focused: string | null,
  ) => void;
}): JSX.Element {
  if (status === "none") return <p className="muted">No project open</p>;
  return (
    <div className="files-panel">
      {status === "unavailable" ? (
        <p className="muted" role="alert">
          The files couldn't be listed ({message ?? "no detail"}).
        </p>
      ) : status === "loading" ? (
        <p className="muted">Loading files…</p>
      ) : (
        <FileTree
          rows={rows}
          selected={selected}
          onSelect={onSelect}
          onActivate={onActivate}
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  );
}

/** The Files view of the left column (UX-16). */
export function FilesPanel(): JSX.Element {
  const status = useFiles((s) => s.status);
  const message = useFiles((s) => s.message);
  const files = useFiles((s) => s.files);
  const registry = useFiles((s) => s.registry);
  const expanded = useFiles((s) => s.expanded);
  const selected = useFiles((s) => s.selected);
  const rows = useMemo(
    () => fileTreeRows({ files, registry, expanded }),
    [files, registry, expanded],
  );
  const host = useRef<HTMLDivElement>(null);
  const typeAhead = useRef<TypeAhead>({ text: "", at: 0 });
  const hadFocus = useRef(false);
  const focusRow = (path: string) =>
    host.current
      ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
      ?.focus();
  // after a re-pull that removed the focused row, focus moves to the selection (its parent), else the first row
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each new list of rows only
  useEffect(() => {
    const tree = host.current;
    if (!hadFocus.current || tree === null) return;
    if (tree.contains(document.activeElement)) return;
    const target = filesStore.getState().selected ?? rows[0]?.path;
    if (target !== undefined) focusRow(target);
  }, [rows]);
  const onKeyDown = (
    event: KeyboardEvent<HTMLUListElement>,
    focused: string | null,
  ) => {
    const { action, typeAhead: next } = treeKey(
      rows,
      focused,
      event.nativeEvent,
      typeAhead.current,
      event.timeStamp,
    );
    typeAhead.current = next;
    // keys the tree owns never reach the shortcuts (G, S and C stay inert), even when they move nothing
    const mods = event.ctrlKey || event.metaKey || event.altKey;
    if (!mods && (event.key.length === 1 || NAV_KEYS.has(event.key)))
      event.preventDefault();
    if (action.kind === "none") return;
    const files = filesStore.getState();
    switch (action.kind) {
      case "focus":
        focusRow(action.path);
        break;
      case "expand":
        files.expand(action.path);
        break;
      case "collapse":
        files.collapse(action.path);
        break;
      case "toggle":
        files.toggle(action.path);
        break;
      case "open":
        void files.open(action.path);
        break;
    }
  };
  const store = filesStore.getState();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it only watches where focus is, for focus after a re-pull
    <div
      ref={host}
      onFocus={() => {
        hadFocus.current = true;
      }}
      onBlur={(event) => {
        // focus leaving the tree for elsewhere, not a row being removed
        if (!host.current?.contains(event.relatedTarget as Node | null))
          hadFocus.current = false;
      }}
    >
      <FilesPanelView
        status={status}
        message={message}
        rows={rows}
        selected={selected}
        onSelect={store.select}
        onActivate={(row) => {
          if (row.kind === "folder") store.toggle(row.path);
          else void store.open(row.path);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
