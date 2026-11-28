// The Files view's store (F-210, AR-30): the project's file list pulled from the worker while the panel is visible, and
// the tree's session-only state (expanded folders, selection). It holds paths, statuses and counts, never file text.
import {
  type EngineApi,
  type FileSummary,
  folderSet,
  openTarget,
  type RegistryFolder,
} from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  canvasStore,
  type WorkspaceActions,
  type WorkspaceState,
} from "../canvas/canvas-store";
import {
  getEngine,
  onEngineChange,
  onLayoutWritten,
} from "../engine/engine-client";

export type FilesStatus = "none" | "loading" | "ready" | "unavailable";

/** A line for the panel's status region: a message, or a refusal outside a dialog. */
export interface FilesNotice {
  readonly tone: "status" | "alert";
  readonly text: string;
}

export interface FilesState {
  /** The canvas session the list belongs to. */
  readonly session: number;
  readonly status: FilesStatus;
  readonly message: string | null;
  readonly files: readonly FileSummary[];
  readonly registry: readonly RegistryFolder[];
  readonly expanded: ReadonlySet<string>;
  readonly selected: string | null;
  readonly notice: FilesNotice | null;
  readonly visible: boolean;
}

export interface FilesActions {
  /** The panel is shown or hidden; showing it pulls when the list is missing or stale. */
  setVisible(visible: boolean): void;
  refresh(): Promise<void>;
  toggle(path: string): void;
  expand(path: string): void;
  collapse(path: string): void;
  select(path: string | null): void;
  /** Expands every folder above `path` and selects it. */
  reveal(path: string): void;
  /** Opens a file: a script with a workflow shows its canvas, anything else a code-only tab (UX-20, UX-52). */
  open(path: string): Promise<void>;
  /** The folder new files go to: the selected folder, else the selected file's folder, else the top. */
  targetFolder(): string;
  notify(notice: FilesNotice | null): void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const folderOf = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

const ancestors = (path: string): string[] => {
  const out: string[] = [];
  for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1))
    out.push(path.slice(0, at));
  return out;
};

export function createFilesStore(deps: {
  engine: () => Pick<EngineApi, "listFiles">;
  canvas: StoreApi<WorkspaceState & WorkspaceActions>;
  onChange: (fn: () => void) => () => void;
}): StoreApi<FilesState & FilesActions> {
  const { engine, canvas } = deps;
  return createStore<FilesState & FilesActions>()((set, get) => {
    let inFlight = false;
    let again = false;
    // set by a change while hidden or before the first reply: the list is out of date
    let stale = true;
    // counts pulls and session changes, so a reply that is no longer the newest is dropped
    let requests = 0;

    async function pull(): Promise<void> {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        do {
          again = false;
          const { summary, session } = canvas.getState();
          if (summary === null) break;
          const mine = ++requests;
          stale = false;
          if (get().status !== "ready") set({ status: "loading" });
          let result: Awaited<ReturnType<EngineApi["listFiles"]>>;
          try {
            result = await engine().listFiles();
          } catch (error) {
            result = {
              ok: false,
              revision: null,
              code: "internal",
              message: messageOf(error),
              path: null,
              problems: [],
            };
          }
          if (canvas.getState().session !== session || mine !== requests)
            continue;
          if ("ok" in result) {
            set({ status: "unavailable", message: result.message });
            continue;
          }
          const folders = folderSet(result.files);
          const { expanded, selected } = get();
          // a folder that vanished leaves the set; a selection that vanished falls back to its nearest parent
          const kept = new Set([...expanded].filter((f) => folders.has(f)));
          const exists = (p: string) =>
            folders.has(p) || result.files.some((f) => f.path === p);
          let next = selected;
          while (next !== null && !exists(next))
            next = folderOf(next) === "" ? null : folderOf(next);
          set({
            session,
            status: "ready",
            message: null,
            files: result.files,
            registry: result.registry,
            expanded: kept,
            selected: next,
          });
        } while (again);
      } finally {
        inFlight = false;
      }
    }

    const reset = (session: number, hasProject: boolean) => {
      requests++;
      stale = true;
      set({
        session,
        status: hasProject ? "loading" : "none",
        message: null,
        files: [],
        registry: [],
        expanded: new Set(),
        selected: null,
        notice: null,
      });
      if (hasProject && get().visible) void pull();
    };

    canvas.subscribe((state, before) => {
      if (state.session !== before.session)
        reset(state.session, state.summary !== null);
    });
    deps.onChange(() => {
      stale = true;
      if (get().visible && canvas.getState().summary !== null) void pull();
    });

    const setExpanded = (change: (s: Set<string>) => void) => {
      const next = new Set(get().expanded);
      change(next);
      set({ expanded: next });
    };

    return {
      session: canvas.getState().session,
      status: canvas.getState().summary === null ? "none" : "loading",
      message: null,
      files: [],
      registry: [],
      expanded: new Set(),
      selected: null,
      notice: null,
      visible: false,

      setVisible(visible) {
        if (get().visible === visible) return;
        set({ visible });
        if (visible && stale && canvas.getState().summary !== null) void pull();
      },
      refresh: pull,
      toggle(path) {
        setExpanded((s) => {
          if (!s.delete(path)) s.add(path);
        });
      },
      expand: (path) => setExpanded((s) => void s.add(path)),
      collapse: (path) => setExpanded((s) => void s.delete(path)),
      select: (path) => set({ selected: path }),
      reveal(path) {
        setExpanded((s) => {
          for (const a of ancestors(path)) s.add(a);
        });
        set({ selected: path });
      },
      async open(path) {
        const { summary } = canvas.getState();
        if (summary === null) return;
        set({ selected: path });
        const target = openTarget(path, summary.workflows);
        if (target.kind === "workflow")
          await canvas.getState().openWorkflow(path, target.workflow);
        else await canvas.getState().openFile(path);
      },
      targetFolder() {
        const { selected, files } = get();
        if (selected === null) return "";
        return folderSet(files).has(selected) ? selected : folderOf(selected);
      },
      notify: (notice) => set({ notice }),
    };
  });
}

export const filesStore = createFilesStore({
  engine: getEngine,
  canvas: canvasStore,
  // edits and writes, and the layout sidecar a canvas move writes (F-207)
  onChange: (fn) => {
    const stops = [onEngineChange(fn), onLayoutWritten(fn)];
    return () => {
      for (const stop of stops) stop();
    };
  },
});

export function useFiles<T>(
  selector: (state: FilesState & FilesActions) => T,
): T {
  return useStore(filesStore, selector);
}
