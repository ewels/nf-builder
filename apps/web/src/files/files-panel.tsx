import {
  type FileTreeRow,
  fileTreeRows,
  folderOf,
  folderSet,
  isManagedPath,
  joinFolder,
  newFolderProblem,
  newPathProblem,
  projectTreeOf,
} from "@nf-builder/engine";
import type {
  ChangeEvent,
  DragEvent,
  JSX,
  KeyboardEvent,
  ReactNode,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { canvasStore, useWorkspace } from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";
import { useProjects } from "../project/project-store";
import { GlyphIcon } from "../shell/icons";
import { type AddFilesState, createAddFiles } from "./add-files";
import { AddFilesDialog } from "./add-files-dialog";
import { dropKind, isFileDrag } from "./drop";
import { FileTree } from "./file-tree";
import {
  type FilesNotice,
  type FilesStatus,
  filesStore,
  useFiles,
} from "./files-store";
import { NewPathDialog } from "./new-path-dialog";
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

const DROP_HINT = "Drop files or a .zip here to add them to the project.";
const MANAGED_TARGET =
  "nf-builder keeps .nf-builder/ up to date itself. Choose another folder.";

/** The panel's layout: the header with its actions, the status line, the tree or why there isn't one, and the drop hint. */
export function FilesPanelView({
  status,
  message,
  projectName,
  rows,
  selected,
  notice,
  dropTarget = null,
  uploadDisabled = false,
  onNew,
  onFiles,
  onSelect,
  onActivate,
  onKeyDown,
  dialogs,
}: {
  readonly status: FilesStatus;
  readonly message: string | null;
  readonly projectName?: string;
  readonly rows: readonly FileTreeRow[];
  readonly selected: string | null;
  readonly notice?: FilesNotice | null;
  /** The folder a file drag is over: "" is the top of the project, null is no drag. */
  readonly dropTarget?: string | null;
  readonly uploadDisabled?: boolean;
  readonly onNew?: (kind: "file" | "folder") => void;
  readonly onFiles?: (files: readonly File[]) => void;
  readonly onSelect: (path: string) => void;
  readonly onActivate: (row: FileTreeRow) => void;
  readonly onKeyDown?: (
    event: KeyboardEvent<HTMLUListElement>,
    focused: string | null,
  ) => void;
  readonly dialogs?: ReactNode;
}): JSX.Element {
  const picker = useRef<HTMLInputElement>(null);
  if (status === "none") return <p className="muted">No project open</p>;
  return (
    <div className="files-panel">
      <header className="files-header">
        <h3 className="files-title" title={projectName}>
          {projectName}
        </h3>
        <button
          type="button"
          className="icon-button"
          aria-label="New file"
          title="New file"
          onClick={() => onNew?.("file")}
        >
          <GlyphIcon name="new-file" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="New folder"
          title="New folder"
          onClick={() => onNew?.("folder")}
        >
          <GlyphIcon name="new-folder" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Upload files"
          title={
            uploadDisabled
              ? "Choose a folder other than .nf-builder/"
              : "Upload files"
          }
          disabled={uploadDisabled}
          onClick={() => picker.current?.click()}
        >
          <GlyphIcon name="upload" />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Files to upload"
          data-testid="files-upload"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const chosen = [...(event.target.files ?? [])];
            // choosing the same file again still fires change
            event.target.value = "";
            onFiles?.(chosen);
          }}
        />
      </header>
      {/* one live region that stays in the page, so its changes are announced */}
      <p className="files-status muted" role="status">
        {notice?.tone === "status" ? notice.text : null}
      </p>
      {notice?.tone === "alert" ? (
        <p className="files-alert" role="alert">
          {notice.text}
        </p>
      ) : null}
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
          dropTarget={dropTarget === "" ? null : dropTarget}
          onSelect={onSelect}
          onActivate={onActivate}
          onKeyDown={onKeyDown}
        />
      )}
      <p className="files-hint muted">{DROP_HINT}</p>
      {dialogs}
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
  const notice = useFiles((s) => s.notice);
  const session = useWorkspace((s) => s.session);
  const source = useWorkspace((s) => s.source);
  const current = useProjects((s) => s.status.current);
  const rows = useMemo(
    () => fileTreeRows({ files, registry, expanded }),
    [files, registry, expanded],
  );
  const folders = useMemo(() => folderSet(files), [files]);
  const host = useRef<HTMLDivElement>(null);
  const typeAhead = useRef<TypeAhead>({ text: "", at: 0 });
  const hadFocus = useRef(false);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [creating, setCreating] = useState<{
    kind: "file" | "folder";
    folder: string;
    session: number;
  } | null>(null);
  const [adding, setAdding] = useState<AddFilesState>({ status: "idle" });
  const add = useRef<ReturnType<typeof createAddFiles>>(undefined);
  add.current ??= createAddFiles({
    workspace: getEngine,
    session: () => canvasStore.getState().session,
    flush: () => canvasStore.getState().flushEdits(),
    onChange: (state) => {
      setAdding(state);
      const { notify } = filesStore.getState();
      if (state.status === "reading")
        notify({ tone: "status", text: `Reading ${state.name}…` });
      else if (state.status === "refused")
        notify({ tone: "alert", text: state.message });
      else if (state.status === "ready") notify(null);
    },
    onAdded: (folder, count) => {
      const store = filesStore.getState();
      if (folder !== "") store.reveal(folder);
      const what = count === 1 ? "1 file" : `${count} files`;
      store.notify({
        tone: "status",
        text: `Added ${what} to ${folder === "" ? "the top of the project" : `${folder}/`}.`,
      });
    },
  });
  const adder = add.current;
  // another project: a half-finished add belongs to the old one
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the project changes
  useEffect(() => () => adder.cancel(), [session, adder]);

  const target = filesStore.getState().targetFolder();
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
    const next = filesStore.getState().selected ?? rows[0]?.path;
    if (next !== undefined) focusRow(next);
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
    const store = filesStore.getState();
    switch (action.kind) {
      case "focus":
        focusRow(action.path);
        break;
      case "expand":
        store.expand(action.path);
        break;
      case "collapse":
        store.collapse(action.path);
        break;
      case "toggle":
        store.toggle(action.path);
        break;
      case "open":
        void store.open(action.path);
        break;
    }
  };

  /** The folder a drag or drop is over: a folder row, a file's folder, else the top of the project. */
  const folderAt = (element: EventTarget | null): string => {
    const path =
      element instanceof Element
        ? element.closest<HTMLElement>("[data-path]")?.dataset.path
        : undefined;
    if (path === undefined) return "";
    return folders.has(path) ? path : folderOf(path);
  };
  const refuseManaged = () =>
    filesStore.getState().notify({ tone: "alert", text: MANAGED_TARGET });
  const onDrag = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag([...event.dataTransfer.types])) return;
    event.preventDefault();
    const over = folderAt(event.target);
    event.dataTransfer.dropEffect = isManagedPath(over) ? "none" : "copy";
    setDropFolder(over);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag([...event.dataTransfer.types])) return;
    event.preventDefault();
    setDropFolder(null);
    const folder = folderAt(event.target);
    if (isManagedPath(folder)) return refuseManaged();
    // the entries are only readable while the event is being handled
    const entries = [...event.dataTransfer.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.webkitGetAsEntry?.() ?? null);
    filesStore.getState().notify(null);
    adder.start(dropKind([...event.dataTransfer.files], entries), folder);
  };

  const tree = () => projectTreeOf(files.map((f) => f.path));
  const projectName =
    source === "project" && current !== null ? current.name : "Unsaved project";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop zone has no keyboard equivalent; Upload files is the one
    <div
      ref={host}
      data-file-drop={status === "none" ? undefined : ""}
      className={status === "none" ? undefined : "files-drop"}
      data-dragging={dropFolder === "" ? "" : undefined}
      onDragEnter={status === "none" ? undefined : onDrag}
      onDragOver={status === "none" ? undefined : onDrag}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropFolder(null);
      }}
      onDrop={status === "none" ? undefined : onDrop}
      onFocus={() => {
        hadFocus.current = true;
      }}
      onBlur={(event) => {
        // focus leaving the panel for elsewhere, not a row being removed
        if (!host.current?.contains(event.relatedTarget as Node | null))
          hadFocus.current = false;
      }}
    >
      <FilesPanelView
        status={status}
        message={message}
        projectName={projectName}
        rows={rows}
        selected={selected}
        notice={notice}
        dropTarget={dropFolder}
        uploadDisabled={isManagedPath(target)}
        onNew={(kind) => setCreating({ kind, folder: target, session })}
        onFiles={(chosen) => {
          if (chosen.length === 0) return;
          filesStore.getState().notify(null);
          adder.start(dropKind(chosen, []), target);
        }}
        onSelect={filesStore.getState().select}
        onActivate={(row) => {
          if (row.kind === "folder") filesStore.getState().toggle(row.path);
          else void filesStore.getState().open(row.path);
        }}
        onKeyDown={onKeyDown}
        dialogs={
          <>
            {creating === null ? null : (
              <NewPathDialog
                kind={creating.kind}
                folder={creating.folder}
                check={(name) =>
                  creating.kind === "file"
                    ? newPathProblem(joinFolder(creating.folder, name), tree())
                    : newFolderProblem(
                        joinFolder(creating.folder, name),
                        tree(),
                      )
                }
                onSubmit={(name) =>
                  creating.kind === "file"
                    ? filesStore.getState().createFile(name, creating)
                    : filesStore.getState().createFolder(name, creating)
                }
                onClose={() => setCreating(null)}
              />
            )}
            {adding.status === "ready" ? (
              <AddFilesDialog
                view={{ ...adder, state: adding }}
                onClose={adder.cancel}
              />
            ) : null}
          </>
        }
      />
    </div>
  );
}
