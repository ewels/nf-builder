// The canvas store (F-205, AR-30): the open project's summary, its workflow tabs and the active tab's projection, the
// UI's read-only copy. The engine is injected so tests use a fake; `canvasStore` uses the worker-backed one. The project
// store (F-202) opens stored projects in the worker and hands the summary to `show`; `open` is the test hook's raw open.
import {
  type ApplyOptions,
  type ApplyOutcome,
  type ConnectionTarget,
  canvasView,
  type EditCommand,
  EMPTY_HISTORY,
  type EngineApi,
  type EngineRefusal,
  type FieldProblem,
  formatNodeKey,
  type HistoryOutcome,
  type HistoryStatus,
  languageOf,
  type NodeDetails,
  type OpenRequest,
  type Point,
  type PortRef,
  type Positions,
  type ProjectChange,
  type Projection,
  type ProjectSummary,
  paletteAction,
  parseNodeKey,
  type QuickFix,
  type ReadOnlyReason,
  readOnlyReason,
  type TypedProcessForm,
  type WorkflowRef,
  type WorkflowTarget,
} from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { getEngine, onEngineChange } from "../engine/engine-client";
import { fileEditorOf, openTargetOf } from "../files/file-kinds";
import { isReadOnly, READ_ONLY_REFUSAL } from "../read-only/read-only-store";
import { modesFor, type ViewMode } from "../views/view-mode";

export interface WorkflowTab {
  /** `<path>#<workflow>`, the empty name for the entry workflow (the projection key prefix, ADR 0036); `file:<path>` for a file tab, `config:<path>` for a config tab (F-601). */
  readonly id: string;
  /** A workflow's canvas tab, or a code-only tab of a file (F-309, UX-20). */
  readonly kind: "workflow" | "file" | "config";
  readonly path: string;
  /** Null for the entry workflow. */
  readonly workflow: string | null;
  readonly label: string;
  /** The tooltip: the full path of a file tab. */
  readonly title?: string;
  /** The view mode of this tab, for the session (AR-30, UX-27). */
  readonly mode: ViewMode;
  /** Why a file tab can't be edited (F-210, IO-02), or null. Always null for a workflow tab. */
  readonly readOnly: ReadOnlyReason | null;
}

export type CanvasContent =
  | { readonly status: "empty" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly revision: number;
      readonly projection: Projection;
      /** The node positions: stored ones from the engine, then those placed and moved here (F-207). Whole nodes only. */
      readonly positions: Positions;
      /** False for the one view that shows a node just added from the palette: the canvas keeps its viewport (F-301). */
      readonly refit: boolean;
      /** Why layout isn't as expected (ELK failed, a save was refused), or null. */
      readonly notice: string | null;
    }
  | { readonly status: "unavailable"; readonly message: string };

/** The worker's details for the selected node (F-206). */
export type DetailsContent =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly node: string }
  | {
      readonly status: "ready";
      readonly node: string;
      readonly revision: number;
      readonly details: NodeDetails;
    }
  | {
      readonly status: "unavailable";
      readonly node: string;
      readonly message: string;
    };

/** Who opened the project on show: a stored project (F-202) or a raw `open` of the test hook, which is never stored. */
export type CanvasSource = "project" | "unsaved";

export interface WorkspaceState {
  readonly source: CanvasSource | null;
  /** Counts the projects shown; a command sent from an older session never reaches the engine (ADR 0004, IO-01). */
  readonly session: number;
  readonly summary: ProjectSummary | null;
  readonly tabs: readonly WorkflowTab[];
  readonly activeTab: string | null;
  readonly content: CanvasContent;
  /** Session only (F-205 open point 11). */
  readonly portLabels: boolean;
  /** The last change to the project and the files it touched, never their text (AR-30). */
  readonly lastChange: {
    readonly revision: number;
    readonly paths: readonly string[];
  } | null;
  /** The selected node's id, in the active tab's projection (single selection, F-206). */
  readonly selected: string | null;
  readonly details: DetailsContent;
  /**
   * The layout file's own problem, shown for the session: it was unreadable (and is replaced at the first save) or
   * comes from a newer nf-builder (and is never written). Null otherwise (F-207).
   */
  readonly layoutNotice: string | null;
  /** What the engine's undo and redo stacks hold (F-209, AR-23). */
  readonly history: HistoryStatus;
  /** The last undo or redo result or refusal, for the history live region (F-209). */
  readonly historyNotice: string | null;
  /** The last request to show a range of a file's code: offsets only, never text; `seq` rises with each (F-309). */
  readonly reveal: {
    readonly path: string;
    readonly start: number;
    readonly end: number;
    readonly seq: number;
  } | null;
  /** The last request to centre a node of the active tab's canvas (F-309). */
  readonly focusNode: { readonly id: string; readonly seq: number } | null;
  /** Why the last connect or disconnect was refused; the next change to the project clears it (F-302). */
  readonly canvasNotice: string | null;
}

export interface WorkspaceActions {
  /** The test hook: a raw, unsaved open in the engine, then `show`. */
  open(request: OpenRequest): Promise<ProjectSummary>;
  /** Shows a project the engine has just opened: its default workflow's tab and projection. */
  show(summary: ProjectSummary, source?: CanvasSource): Promise<void>;
  /** The stored project is no longer current (deleted, closed, a failed open): back to the empty canvas. */
  projectGone(): void;
  /** The engine changed the open project: re-project the active tab, or open the default workflow of a blank project. */
  changed(change: ProjectChange): Promise<void>;
  openWorkflow(path: string, workflow: string | null): Promise<void>;
  /**
   * Opens a code-only tab for a file, once per path, and shows it (F-309, UX-20). A `.nf` file that has a workflow opens
   * that workflow's canvas tab instead. F-210, F-605 and F-601 open files through this.
   */
  openFile(path: string): Promise<void>;
  /**
   * Opens a project file by its path (F-605, UX-52): a file with workflows in its default workflow's tab, any other
   * text file in a file tab, and a path that isn't in the project nowhere. Preview links and the Files view use it.
   */
  openPath(path: string): Promise<"workflow" | "file" | "missing">;
  /** Closes a file tab (F-210); the previous tab takes over, else the next, else none. Workflow tabs stay open (F-307). */
  closeTab(id: string): Promise<void>;
  /** Asks the file's code editor to select and scroll to a range; the editor shows it when it is mounted (F-309). */
  revealCode(path: string, range: { start: number; end: number }): void;
  /** Asks the active canvas to centre a node at its current zoom (F-309). */
  focusOn(id: string): void;
  selectTab(id: string): Promise<void>;
  setMode(tabId: string, mode: ViewMode): void;
  setPortLabels(value: boolean): void;
  /**
   * The single UI path for edit commands: sends `command` at the current revision; the change then reaches `changed`.
   * With a `session`, a command from a project that is no longer shown is refused without calling the engine.
   */
  apply(
    command: EditCommand,
    session?: number,
    options?: ApplyOptions,
  ): Promise<ApplyOutcome>;
  /**
   * Applies a quick fix diagnosed at `revision` as one undo step (F-309, ADR 0042). Pending code edits are sent first, so
   * the fix may then be refused as stale. Joins the queue of applies, undos and redos.
   */
  applyFix(
    fix: QuickFix,
    revision: number,
    session?: number,
    options?: ApplyOptions,
  ): Promise<ApplyOutcome>;
  /** Undoes the newest step (F-209). Pending code edits are sent first. Applies, undos and redos run one at a time. */
  undo(session?: number): Promise<HistoryOutcome>;
  redo(session?: number): Promise<HistoryOutcome>;
  /** A code pane registers its flush, awaited before an undo or redo; returns the unregister function. */
  registerFlush(flush: () => Promise<void>): () => void;
  /** Awaits every registered flush, so pending code edits are sent; one that fails doesn't stop the others (F-703). */
  flushEdits(): Promise<void>;
  /** Selects a node and loads its details; null clears the selection. */
  select(id: string | null): Promise<void>;
  /**
   * Keeps and saves the nodes the user has moved (a drag stop or a keyboard move). Moves are rounded, and one that
   * lands where the node is saves nothing. Not undoable in v0.1 (F-207).
   */
  moveNodes(moves: Positions): Promise<void>;
  /**
   * Takes the result of a layout run on the canvas. Dropped when the tab or the projection it was computed for is no
   * longer shown.
   */
  placeNodes(
    at: { readonly tab: string; readonly revision: number },
    placement: Placement,
  ): Promise<void>;
  /**
   * Adds a new process or workflow from the palette: a fresh name, then `CreateProcess` or `CreateWorkflow` and
   * `AddCall` as one undo step, the node placed at `request.at` before it is first drawn. A refused add is undone, so
   * it changes nothing (F-301, UX-15, AR-23). Runs as one task of the queue of applies, undos and redos.
   */
  addFromPalette(
    request: PaletteAdd,
    session?: number,
  ): Promise<PaletteAddOutcome>;
  /**
   * Applies the popup's edit of a typed process (F-303, UX-44): one `UpdateDeclaration`, or, when the name changes, that
   * update, `RenameDeclaration` and the move of the module folder as one undo step (AR-23, ADR 0051). A refused part
   * undoes the parts before it, so a refusal changes nothing. Refused as stale when the project moved on since
   * `request.revision`. Runs as one task of the queue of applies, undos and redos.
   */
  editDeclaration(
    request: DeclarationEdit,
    session?: number,
  ): Promise<EditOutcome>;
  /**
   * Adds a registry plugin to the project's `plugins` block as one undo step: `CreateFile` of `nextflow.config` first
   * when it is missing, then `AddConfigPlugin`. A refused second part is undone, so a refusal changes nothing (F-505,
   * IO-33, AR-23). Runs as one task of the queue of applies, undos and redos.
   */
  addPlugin(request: PluginAdd, session?: number): Promise<PluginAddOutcome>;
  /**
   * Feeds the `from` output port into the `to` input port of the active workflow tab as one undo step (F-302, UX-25).
   * A refusal sets `canvasNotice`. The view that follows keeps the viewport (ADR 0052).
   */
  connect(from: PortRef, to: PortRef, session?: number): Promise<ApplyOutcome>;
  /** Removes the argument that feeds `port` in the active workflow tab (F-302, UX-70). Refusals as `connect`. */
  disconnect(port: PortRef, session?: number): Promise<ApplyOutcome>;
  /**
   * The status of every input port of the active workflow for a dragged output port (F-302, UX-25). Null when the
   * project, tab or revision moved on, or nothing can be answered (read-only, no workflow tab, a refusal).
   */
  connectionTargets(
    from: PortRef,
    session?: number,
  ): Promise<readonly ConnectionTarget[] | null>;
}

/** A layout run on the canvas: every node's position, and what to save (`saved`, merged, or replacing the workflow's entries). */
export interface Placement {
  readonly positions: Positions;
  readonly saved: Positions;
  readonly replace: boolean;
  readonly notice: string | null;
}

/** Adds a palette item to a workflow tab (F-301, UX-15). */
export interface PaletteAdd {
  /** The palette item's key. */
  readonly item: string;
  /** The workflow tab's id. */
  readonly tab: string;
  /** Where the node's centre goes, in flow coordinates; null leaves the placement to the layout. */
  readonly at: Point | null;
}

export type PaletteAddOutcome =
  | {
      readonly ok: true;
      readonly name: string;
      readonly path: string;
      readonly node: string;
    }
  | { readonly ok: false; readonly message: string };

/** The popup's edit of a typed process (F-303). */
export interface DeclarationEdit {
  /** The declaration's file and name, as the form was read. */
  readonly target: { readonly path: string; readonly name: string };
  /** The revision the form was read at. */
  readonly revision: number;
  readonly form: TypedProcessForm;
  /** The node the popup was opened from; selected again afterwards. */
  readonly node: string;
}

export type EditOutcome =
  | { readonly ok: true; readonly node: string }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fields: readonly FieldProblem[];
    };

/** A registry plugin to add to `nextflow.config` (F-505, IO-33). */
export interface PluginAdd {
  readonly id: string;
  /** The snapshot's release. */
  readonly version: string;
}

export type PluginAddOutcome =
  | { readonly ok: true; readonly id: string; readonly version: string }
  | { readonly ok: false; readonly message: string };

/** The workflow a project opens with: main.nf's entry, else the first entry workflow, else the first named one. */
export function defaultWorkflow(
  workflows: readonly WorkflowRef[],
): WorkflowRef | null {
  return (
    workflows.find((w) => w.name === null && w.path === "main.nf") ??
    workflows.find((w) => w.name === null) ??
    workflows[0] ??
    null
  );
}

const fileName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

/** The tab label of a file: its name, with the folder too for the many `main.nf` of a project (`legacy_count/main.nf`). */
const fileLabel = (path: string): string =>
  path.endsWith("/main.nf")
    ? path.split("/").slice(-2).join("/")
    : fileName(path);

/** A code-only tab for a file (F-309, UX-20). */
export function fileTabFor(path: string): WorkflowTab {
  return {
    id: `file:${path}`,
    kind: "file",
    path,
    workflow: null,
    label: fileLabel(path),
    title: path,
    mode: fileEditorOf(path) === "markdown" ? "preview" : "code",
    readOnly: readOnlyReason(path),
  };
}

/** A config tab (F-601, UX-27): the form of a `.config` file, shown as Graph mode, with its code beside it in Split. */
export function configTabFor(path: string): WorkflowTab {
  return {
    id: `config:${path}`,
    kind: "config",
    path,
    workflow: null,
    label: fileLabel(path),
    title: path,
    mode: "graph",
    readOnly: readOnlyReason(path),
  };
}

/** Whether a tab has no canvas projection: a code-only file tab or a config tab. */
export const isFileLike = (tab: { readonly kind: string }): boolean =>
  tab.kind !== "workflow";

export function tabFor(ref: {
  readonly path: string;
  readonly name: string | null;
}): WorkflowTab {
  return {
    id: `${ref.path}#${ref.name ?? ""}`,
    kind: "workflow",
    path: ref.path,
    workflow: ref.name,
    label: ref.name ?? fileName(ref.path),
    mode: "graph",
    readOnly: null,
  };
}

const CONFIG_PATH = "nextflow.config";
const NO_PROJECT_ADD = "Open or create a project to add components.";
const FILE_TAB_ADD = "Open a workflow tab to add components to it.";
const NO_PROJECT_EDIT = "Open a project to edit it.";
const NO_ACTION_ADD = "That item can't be added from the palette yet.";

const REPLACED_NOTICE = "The layout file couldn't be read and was replaced.";

const STALE_MOVE =
  "Your last move couldn't be saved because the workflow changed. Move the node again.";
/**
 * Pairs each workflow that vanished from a file with the one that appeared in it, when there is exactly one of each:
 * a rename, forwards or back (F-209). Keys are tab ids.
 */
function renamedTabs(
  before: readonly WorkflowRef[],
  after: readonly WorkflowRef[],
): Map<string, WorkflowRef> {
  const key = (w: WorkflowRef) => tabFor(w).id;
  const had = new Set(before.map(key));
  const has = new Set(after.map(key));
  const out = new Map<string, WorkflowRef>();
  for (const path of new Set(before.map((w) => w.path))) {
    const gone = before.filter((w) => w.path === path && !has.has(key(w)));
    const added = after.filter((w) => w.path === path && !had.has(key(w)));
    const [from] = gone;
    const [to] = added;
    if (gone.length === 1 && added.length === 1 && from && to)
      out.set(key(from), to);
  }
  return out;
}

const refusal = (
  code: EngineRefusal["code"],
  message: string,
): EngineRefusal => ({
  ok: false,
  revision: null,
  code,
  message,
  path: null,
  problems: [],
});

const EMPTY: CanvasContent = { status: "empty" };
const IDLE: DetailsContent = { status: "idle" };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Where a file went when the change moved it or a folder above it (F-303). */
function movedPath(
  path: string,
  moves: readonly { readonly from: string; readonly to: string }[],
): string {
  for (const m of moves) {
    if (path === m.from) return m.to;
    if (path.startsWith(`${m.from}/`))
      return `${m.to}${path.slice(m.from.length)}`;
  }
  return path;
}

/** `modules/local/<lower name>`, the folder of a module of that name (LA-12). */
const folderOf = (name: string): string =>
  `modules/local/${name.toLowerCase()}`;

/** The module folder of a process whose file is its module's `main.nf`; else null. */
function moduleFolder(path: string, name: string): string | null {
  const folder = folderOf(name);
  return path === `${folder}/main.nf` ? folder : null;
}

/** Whether the declarations of a file are this process alone: a module folder moves only then (LA-12). */
function declaresOnly(
  items: readonly { readonly kind: string; readonly name: string }[],
  name: string,
): boolean {
  const declared = items.filter((i) =>
    [
      "process",
      "workflow",
      "function",
      "record",
      "enum",
      "agent",
      "unparsed",
    ].includes(i.kind),
  );
  return declared.length === 1 && declared[0]?.name === name;
}

/** The key of a node after its process was renamed: an unassigned call carries the callee in its key. */
function nodeAfterRename(
  node: string,
  from: string,
  to: string,
  content: CanvasContent,
): string {
  if (from === to) return node;
  const key = parseNodeKey(node);
  if (key?.local.kind !== "unassigned" || key.local.callee !== from)
    return node;
  const renamed = formatNodeKey({
    ...key,
    local: { ...key.local, callee: to },
  });
  return content.status === "ready" &&
    content.projection.nodes.some((n) => n.id === renamed)
    ? renamed
    : node;
}

export type CanvasStore = StoreApi<WorkspaceState & WorkspaceActions>;

export function createCanvasStore(
  engine: () => EngineApi,
  readOnly: () => boolean = () => false,
): CanvasStore {
  return createStore<WorkspaceState & WorkspaceActions>()((set, get) => {
    // a result for a superseded tab or project is dropped
    let generation = 0;
    // a details result for a superseded selection is dropped
    let selection = 0;
    // sequence numbers of reveal and focus requests: never reset, so a late editor can tell a request it has seen
    let requests = 0;

    // apply, undo and redo run one at a time, each at the revision the previous one produced
    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
      const run = queue.then(task);
      queue = run.catch(() => undefined);
      return run;
    };
    const flushes = new Set<() => Promise<void>>();
    // the last layout write the engine refused as stale, sent again after the next refresh
    let pendingMove: {
      tab: string;
      positions: Positions;
      replace: boolean;
    } | null = null;
    // the node an add from the palette is about to show, and where its centre goes (F-301)
    let pendingPlacement: {
      session: number;
      tab: string;
      key: string;
      at: Point;
    } | null = null;
    let adds = 0;
    let edits = 0;
    // palette adds in flight: every view they cause keeps the viewport, the intermediate one included (F-301)
    let addsPending = 0;

    /** The active workflow tab, or undefined on a file tab or none. */
    function workflowTab(): WorkflowTab | undefined {
      const tab = get().tabs.find((t) => t.id === get().activeTab);
      return tab?.kind === "workflow" ? tab : undefined;
    }

    /** One connect or disconnect: the views it causes keep the viewport; a refusal becomes the canvas notice. */
    async function rewire(
      verb: "connect" | "disconnect",
      command: (target: WorkflowTarget) => EditCommand,
      session: number | undefined,
    ): Promise<ApplyOutcome> {
      const tab = workflowTab();
      if (tab === undefined)
        return refusal("no-project", "No workflow is shown.");
      addsPending++;
      try {
        const outcome = await send(
          session,
          (revision) =>
            engine().apply(
              command({ path: tab.path, workflow: tab.workflow }),
              revision,
            ),
          afterApply,
        );
        if (!outcome.ok && outcome.code !== "read-only")
          set({ canvasNotice: `Couldn't ${verb}: ${outcome.message}` });
        return outcome;
      } finally {
        addsPending--;
      }
    }

    function clearSelection(): void {
      selection++;
      set({ selected: null, details: IDLE });
    }

    async function load(tab: WorkflowTab, quiet = false): Promise<void> {
      const mine = ++generation;
      // a file tab has no projection: its code pane reads the file itself
      if (isFileLike(tab)) {
        clearSelection();
        set({ activeTab: tab.id, content: EMPTY });
        return;
      }
      if (!quiet) clearSelection();
      // a refresh keeps the canvas on screen (and its viewport) until the new projection arrives
      set(
        quiet
          ? { activeTab: tab.id }
          : { activeTab: tab.id, content: { status: "loading" } },
      );
      let content: CanvasContent;
      try {
        const result = await engine().project(tab.path, tab.workflow);
        if ("ok" in result)
          content = { status: "unavailable", message: result.message };
        else if (result.projection === null)
          content = {
            status: "unavailable",
            message: `${tab.label} could not be parsed, so there is no canvas to show.`,
          };
        else
          content = {
            status: "ready",
            revision: result.revision,
            projection: result.projection,
            positions: result.positions,
            refit: addsPending === 0,
            notice: null,
          };
      } catch (error) {
        content = { status: "unavailable", message: messageOf(error) };
      }
      if (mine !== generation) return;
      if (content.status === "ready") {
        // the node an add from the palette shows gets its place in the same update as the projection, so it is never
        // drawn unplaced and the layout never moves it (ADR 0052); its view never refits, as the add is pending
        const placed = placement(tab, content);
        set({
          content:
            placed === null
              ? content
              : {
                  ...content,
                  positions: { ...content.positions, [placed.key]: placed.at },
                },
        });
        if (placed !== null)
          await save(tab, content.revision, { [placed.key]: placed.at }, false);
      } else {
        set({ content });
        // no canvas, so no node to select (the header and the body agree)
        clearSelection();
      }
    }

    /** The pending add's node and top-left corner when this projection holds it, which uses the placement up. */
    function placement(
      tab: WorkflowTab,
      content: Extract<CanvasContent, { status: "ready" }>,
    ): { key: string; at: Point } | null {
      const pending = pendingPlacement;
      if (
        pending === null ||
        pending.session !== get().session ||
        pending.tab !== tab.id ||
        !content.projection.nodes.some((n) => n.id === pending.key)
      )
        return null;
      pendingPlacement = null;
      const box = canvasView(content.projection, {
        portLabels: true,
      }).nodes.find((n) => n.id === pending.key);
      if (box === undefined) return null;
      return {
        key: pending.key,
        at: {
          x: Math.round(pending.at.x - box.width / 2),
          y: Math.round(pending.at.y - box.height / 2),
        },
      };
    }

    async function loadDetails(id: string): Promise<void> {
      const { tabs, activeTab, content } = get();
      const tab = tabs.find((t) => t.id === activeTab);
      if (tab === undefined || content.status !== "ready") return;
      const mine = ++selection;
      set({ selected: id, details: { status: "loading", node: id } });
      const unavailable = (message: string): DetailsContent => ({
        status: "unavailable",
        node: id,
        message,
      });
      let details: DetailsContent;
      try {
        const result = await engine().details(tab.path, tab.workflow, id);
        if (mine !== selection) return;
        if ("ok" in result) details = unavailable(result.message);
        else if (result.details === null) {
          clearSelection();
          return;
        } else {
          const current = get().content;
          const shown = current.status === "ready" ? current.revision : null;
          if (shown !== null && shown === result.revision)
            details = {
              status: "ready",
              node: id,
              revision: result.revision,
              details: result.details,
            };
          else if (shown !== null && result.revision > shown)
            // the reprojection is on its way, and `changed` loads the details again
            return;
          else
            details = unavailable(
              "The project changed. Select the node again.",
            );
        }
      } catch (error) {
        if (mine !== selection) return;
        details = unavailable(messageOf(error));
      }
      set({ details });
    }

    /** Saves `positions` for the active tab, and keeps the sidecar's status and any refusal where the canvas shows them. */
    async function save(
      tab: WorkflowTab,
      revision: number,
      positions: Positions,
      replace: boolean,
      retried = false,
    ): Promise<void> {
      // read-only writes nothing to the project: placements are shown, never saved (F-703, UX-04)
      if (readOnly()) return;
      let notice: string | null = null;
      try {
        const result = await engine().setLayout({
          revision,
          path: tab.path,
          workflow: tab.workflow,
          positions,
          replace,
        });
        // computed before a change shifted the keys: sent once more after the refresh, if its nodes are still there
        if ("ok" in result && result.code === "stale") {
          if (!retried) {
            pendingMove = { tab: tab.id, positions, replace };
            return;
          }
          notice = STALE_MOVE;
        } else if ("ok" in result)
          notice = `The positions couldn't be saved (${result.message}).`;
        else {
          const { summary } = get();
          if (summary !== null)
            set({
              summary: { ...summary, layout: result.layout },
              // a file newer than this build is a problem for the rest of the session; a replaced one stays reported,
              // in the past tense
              layoutNotice:
                result.layout.message ??
                (summary.layout.state === "invalid" &&
                result.layout.state === "ok"
                  ? REPLACED_NOTICE
                  : get().layoutNotice),
            });
        }
      } catch (error) {
        notice = `The positions couldn't be saved (${messageOf(error)}).`;
      }
      if (notice === null) return;
      const { content, activeTab } = get();
      if (
        content.status === "ready" &&
        content.revision === revision &&
        activeTab === tab.id
      )
        set({ content: { ...content, notice } });
    }

    /** Sends a move the engine refused as stale once more, now that the projection is refreshed; says so if it can't. */
    async function resendMove(tab: WorkflowTab): Promise<void> {
      const pending = pendingMove;
      pendingMove = null;
      if (pending === null || pending.tab !== tab.id) return;
      const { content } = get();
      if (content.status !== "ready") return;
      const present = new Set(content.projection.nodes.map((n) => n.id));
      if (!Object.keys(pending.positions).every((id) => present.has(id))) {
        set({ content: { ...content, notice: STALE_MOVE } });
        return;
      }
      set({
        content: {
          ...content,
          positions: { ...content.positions, ...pending.positions },
        },
      });
      await save(
        tab,
        content.revision,
        pending.positions,
        pending.replace,
        true,
      );
    }

    /** A refusal that reports a newer revision: another writer got in first, so adopt it and show what it left. */
    async function adoptNewer(
      outcome: ApplyOutcome | HistoryOutcome,
    ): Promise<void> {
      const now = get().summary;
      if (outcome.ok || now === null || outcome.revision === null) return;
      if (outcome.revision <= now.revision) return;
      set({ summary: { ...now, revision: outcome.revision } });
      const active = get().tabs.find((t) => t.id === get().activeTab);
      if (active !== undefined) await load(active, true);
    }

    /**
     * Sends one change at the current revision, after every earlier one, and adopts the engine's answer. `after` runs in
     * the same turn, only when the engine was called and the project is still shown.
     */
    async function sendNow<T extends ApplyOutcome | HistoryOutcome>(
      session: number | undefined,
      call: (revision: number) => Promise<T>,
      after: (outcome: T) => Promise<void> | void = adoptNewer,
    ): Promise<T | EngineRefusal> {
      const { summary } = get();
      if (session !== undefined && session !== get().session)
        return refusal("no-project", "The project changed.");
      if (summary === null) return refusal("no-project", "No project is open.");
      // read when the task runs, so an edit flushed on the way to read-only still passes (F-703, UX-04)
      if (readOnly()) return refusal("read-only", READ_ONLY_REFUSAL);
      const outcome = await call(summary.revision);
      const now = get().summary;
      if (now === null) return outcome;
      // the engine client announces changes to `changed` already; this covers an engine that doesn't
      if (outcome.ok && outcome.revision > now.revision)
        await get().changed(outcome);
      await after(outcome);
      return outcome;
    }

    /**
     * Applies `commands` one after another under one history group with `label`, as one undo step. A refused
     * part undoes the parts before it (`discard`, so the step isn't left to redo) and its refusal is returned; else the
     * last part's outcome. Runs inside a task of the queue.
     */
    async function applyGroup(
      session: number | undefined,
      group: string,
      commands: readonly EditCommand[],
      label: string,
    ): Promise<ApplyOutcome> {
      let last: ApplyOutcome | undefined;
      // a part whose patches are empty records no step, so only the others leave a step to undo
      let recorded = false;
      for (const command of commands) {
        const outcome = (await sendNow(
          session,
          async (revision) => {
            try {
              return await engine().apply(
                command,
                revision,
                // every part carries the label: one with no patches starts no step, so a later one may
                { group, label },
              );
            } catch (error) {
              return refusal("internal", messageOf(error));
            }
          },
          afterApply,
        )) as ApplyOutcome;
        if (!outcome.ok) {
          if (recorded)
            // the step holds the parts applied so far, so nothing is left behind
            await sendNow(
              session,
              async (revision) => {
                try {
                  return await engine().undo(revision, { discard: true });
                } catch (error) {
                  return refusal("internal", messageOf(error));
                }
              },
              async (undone) => {
                if (!undone.ok) await refreshHistory();
              },
            );
          return outcome;
        }
        if (outcome.patches?.length !== 0) recorded = true;
        last = outcome;
      }
      return last as ApplyOutcome;
    }

    const send = <T extends ApplyOutcome | HistoryOutcome>(
      session: number | undefined,
      call: (revision: number) => Promise<T>,
      after?: (outcome: T) => Promise<void> | void,
    ): Promise<T | EngineRefusal> =>
      enqueue(() => sendNow(session, call, after));

    async function refreshHistory(): Promise<void> {
      try {
        set({ history: await engine().history() });
      } catch {
        // the status stays as it was; the next change carries it
      }
    }

    /** After an apply or a fix: adopt a newer revision; an internal refusal can follow a write that cleared the history. */
    async function afterApply(outcome: ApplyOutcome): Promise<void> {
      await adoptNewer(outcome);
      if (!outcome.ok && outcome.code === "internal") await refreshHistory();
    }

    /** `call`, with a throw turned into an internal refusal. */
    async function safely<T>(
      call: () => Promise<T>,
    ): Promise<T | EngineRefusal> {
      try {
        return await call();
      } catch (error) {
        return refusal("internal", messageOf(error));
      }
    }

    /** Undoes only the first part of a group, so a refused second part leaves nothing behind. */
    async function discardFirstPart(session: number): Promise<void> {
      await sendNow(
        session,
        (revision) =>
          safely(() =>
            engine().undo(revision, { discard: true }),
          ) as Promise<HistoryOutcome>,
        async (outcome) => {
          if (!outcome.ok) await refreshHistory();
        },
      );
    }

    /** Sends the code panes' pending edits; outside the queue, as their send is queued itself. */
    const flushPending = async (): Promise<void> => {
      await Promise.all([...flushes].map((flush) => flush().catch(() => {})));
    };

    /** Adds `tab` once and shows it. */
    async function openTab(tab: WorkflowTab): Promise<void> {
      if (!get().tabs.some((t) => t.id === tab.id))
        set({ tabs: [...get().tabs, tab] });
      await load(tab);
    }

    async function stepHistory(
      kind: "undo" | "redo",
      session: number | undefined,
    ): Promise<HistoryOutcome> {
      // the project shown when the key was pressed, not whichever is shown once the flushes are done
      const mine = session ?? get().session;
      if (mine !== get().session)
        return refusal("no-project", "The project changed.");
      // pending code edits become the step that gets undone
      await flushPending();
      pendingPlacement = null;
      return send(
        mine,
        async (revision) => {
          try {
            return await engine()[kind](revision);
          } catch (error) {
            return refusal("internal", messageOf(error));
          }
        },
        async (outcome) => {
          if (outcome.ok) {
            set({
              historyNotice: `${kind === "undo" ? "Undone" : "Redone"}: ${outcome.label}`,
            });
            return;
          }
          // no retry: the top step may no longer be the one the user saw
          set({ historyNotice: outcome.message });
          await adoptNewer(outcome);
          await refreshHistory();
        },
      );
    }

    return {
      source: null,
      session: 0,
      summary: null,
      tabs: [],
      activeTab: null,
      content: EMPTY,
      portLabels: true,
      lastChange: null,
      selected: null,
      details: IDLE,
      layoutNotice: null,
      history: EMPTY_HISTORY,
      historyNotice: null,
      reveal: null,
      focusNode: null,
      canvasNotice: null,

      async open(request) {
        generation++;
        pendingMove = null;
        pendingPlacement = null;
        const summary = await engine().open(request);
        await get().show(summary, "unsaved");
        return summary;
      },

      async show(summary, source = "project") {
        generation++;
        pendingMove = null;
        pendingPlacement = null;
        clearSelection();
        const first = defaultWorkflow(summary.workflows);
        const tab = first === null ? null : tabFor(first);
        set({
          source,
          session: get().session + 1,
          summary,
          tabs: tab === null ? [] : [tab],
          activeTab: null,
          content: EMPTY,
          lastChange: null,
          layoutNotice: summary.layout.message,
          history: EMPTY_HISTORY,
          historyNotice: null,
          reveal: null,
          focusNode: null,
          canvasNotice: null,
        });
        if (tab !== null) await load(tab);
      },

      projectGone() {
        if (get().source !== "project") return;
        generation++;
        pendingPlacement = null;
        clearSelection();
        set({
          source: null,
          session: get().session + 1,
          summary: null,
          tabs: [],
          activeTab: null,
          content: EMPTY,
          lastChange: null,
          layoutNotice: null,
          history: EMPTY_HISTORY,
          historyNotice: null,
          reveal: null,
          focusNode: null,
          canvasNotice: null,
        });
      },

      async changed(change) {
        const { summary } = get();
        if (summary === null) return;
        // a workflow renamed (or renamed back) keeps its tab, and its view mode
        const renamed = renamedTabs(summary.workflows, change.workflows);
        // a stale tab that already holds a new id gives way to the renamed one
        const taken = new Set([...renamed.values()].map((w) => tabFor(w).id));
        // a file tab follows its file when the change moved it (F-303)
        const following = (t: WorkflowTab): WorkflowTab => {
          if (!isFileLike(t)) return t;
          const to = movedPath(t.path, change.moves ?? []);
          if (to === t.path) return t;
          return {
            ...(t.kind === "config" ? configTabFor(to) : fileTabFor(to)),
            mode: t.mode,
          };
        };
        const followed = new Map(
          get()
            .tabs.map((t) => [t.id, following(t).id] as const)
            .filter(([from, to]) => from !== to),
        );
        // a file tab goes with its file (text null: deleted, e.g. by undoing CreateProcess)
        const deleted = new Set(
          change.files.filter((f) => f.text === null).map((f) => f.path),
        );
        const before = get().tabs.map(following);
        const tabs = before
          .filter((t) => renamed.has(t.id) || !taken.has(t.id))
          .filter((t) => !(isFileLike(t) && deleted.has(t.path)))
          .map((t) => {
            const to = renamed.get(t.id);
            return to === undefined ? t : { ...tabFor(to), mode: t.mode };
          });
        const current = followed.get(get().activeTab ?? "") ?? get().activeTab;
        const moved = current === null ? undefined : renamed.get(current);
        let activeTab = moved === undefined ? current : tabFor(moved).id;
        // the active file tab went: the previous tab takes over, else the first left
        const closed =
          activeTab !== null && !tabs.some((t) => t.id === activeTab)
            ? before.find((t) => t.id === activeTab)
            : undefined;
        if (closed !== undefined && isFileLike(closed)) {
          const at = before.indexOf(closed);
          const left = before
            .slice(0, at)
            .reverse()
            .find((t) => tabs.some((k) => k.id === t.id));
          activeTab = left?.id ?? tabs[0]?.id ?? null;
        }
        set({
          tabs,
          activeTab,
          history: change.history,
          historyNotice: null,
          canvasNotice: null,
          summary: {
            ...summary,
            revision: change.revision,
            workflows: change.workflows,
          },
          lastChange: {
            revision: change.revision,
            paths: change.files.map((f) => f.path),
          },
        });
        const active = tabs.find((t) => t.id === activeTab);
        if (
          closed !== undefined &&
          isFileLike(closed) &&
          active !== undefined
        ) {
          await load(active);
          return;
        }
        if (active !== undefined && isFileLike(active)) return;
        if (active !== undefined) {
          await load(active, true);
          await resendMove(active);
          const { selected } = get();
          if (selected !== null) await loadDetails(selected);
          return;
        }
        const first = defaultWorkflow(change.workflows);
        if (first === null) return;
        const tab = tabFor(first);
        set({ tabs: [tab] });
        await load(tab);
      },

      openWorkflow: (path, workflow) =>
        openTab(tabFor({ path, name: workflow })),

      async openFile(path) {
        const { summary } = get();
        if (summary === null) return;
        const workflow = defaultWorkflow(
          summary.workflows.filter((w) => w.path === path),
        );
        const language = languageOf(path);
        await openTab(
          workflow !== null
            ? tabFor(workflow)
            : language === "config"
              ? configTabFor(path)
              : fileTabFor(path),
        );
      },

      async openPath(path) {
        const { summary, session } = get();
        if (summary === null) return "missing";
        const target = openTargetOf(path, summary.workflows);
        if (target.kind === "workflow") {
          await openTab(tabFor(target.ref));
          return "workflow";
        }
        let text: string | null;
        try {
          text = await engine().readFile(path);
        } catch {
          text = null;
        }
        // the project may have been replaced while the file was read
        if (text === null || get().session !== session) return "missing";
        await openTab(
          languageOf(path) === "config" ? configTabFor(path) : fileTabFor(path),
        );
        return "file";
      },

      async closeTab(id) {
        const { tabs, activeTab } = get();
        const at = tabs.findIndex((t) => t.id === id);
        const tab = tabs[at];
        if (tab === undefined || !isFileLike(tab)) return;
        const rest = tabs.filter((t) => t.id !== id);
        set({ tabs: rest });
        if (activeTab !== id) return;
        const next = rest[at - 1] ?? rest[at];
        if (next !== undefined) {
          await load(next);
          return;
        }
        generation++;
        clearSelection();
        set({ activeTab: null, content: EMPTY });
      },

      revealCode(path, range) {
        set({
          reveal: { path, start: range.start, end: range.end, seq: ++requests },
        });
      },

      focusOn(id) {
        set({ focusNode: { id, seq: ++requests } });
      },

      async selectTab(id) {
        const tab = get().tabs.find((t) => t.id === id);
        if (tab !== undefined) await load(tab);
      },

      setMode(tabId, mode) {
        set({
          tabs: get().tabs.map((t) =>
            t.id === tabId &&
            modesFor(t.kind, t.path).some((m) => m.mode === mode)
              ? { ...t, mode }
              : t,
          ),
        });
      },

      setPortLabels(portLabels) {
        set({ portLabels });
      },

      apply: (command, session, options) =>
        send(
          session,
          (revision) => engine().apply(command, revision, options),
          afterApply,
        ),

      async applyFix(fix, revision, session, options) {
        const mine = session ?? get().session;
        if (mine !== get().session)
          return refusal("no-project", "The project changed.");
        await flushPending();
        return send(
          mine,
          () => engine().applyFix(fix, revision, options),
          afterApply,
        );
      },

      undo: (session) => stepHistory("undo", session),
      redo: (session) => stepHistory("redo", session),

      registerFlush(flush) {
        flushes.add(flush);
        return () => void flushes.delete(flush);
      },

      flushEdits: flushPending,

      async select(id) {
        if (id === null) {
          clearSelection();
          return;
        }
        const { selected, details } = get();
        if (id === selected && details.status !== "unavailable") return;
        await loadDetails(id);
      },

      async moveNodes(moves) {
        if (readOnly()) return;
        const { content, tabs, activeTab } = get();
        const tab = tabs.find((t) => t.id === activeTab);
        if (content.status !== "ready" || tab === undefined) return;
        const rounded: Record<string, Point> = {};
        for (const [id, at] of Object.entries(moves)) {
          const x = Math.round(at.x);
          const y = Math.round(at.y);
          const now = content.positions[id];
          if (now === undefined || now.x !== x || now.y !== y)
            rounded[id] = { x, y };
        }
        if (Object.keys(rounded).length === 0) return;
        set({
          content: {
            ...content,
            positions: { ...content.positions, ...rounded },
          },
        });
        await save(tab, content.revision, rounded, false);
      },

      async placeNodes(at, placement) {
        const { content, tabs, activeTab } = get();
        const tab = tabs.find((t) => t.id === activeTab);
        if (
          content.status !== "ready" ||
          tab === undefined ||
          tab.id !== at.tab ||
          content.revision !== at.revision
        )
          return;
        // a node the user moved while the layout ran keeps its place; a replace overrides on purpose
        const present = new Set(content.projection.nodes.map((n) => n.id));
        const positions = placement.replace
          ? placement.positions
          : {
              ...placement.positions,
              ...Object.fromEntries(
                Object.entries(content.positions).filter(([id]) =>
                  present.has(id),
                ),
              ),
            };
        set({
          content: {
            ...content,
            positions,
            notice: placement.notice,
          },
        });
        if (placement.replace || Object.keys(placement.saved).length > 0)
          await save(tab, content.revision, placement.saved, placement.replace);
      },

      addFromPalette(request, session) {
        const mine = session ?? get().session;
        const fail = (message: string): PaletteAddOutcome => ({
          ok: false,
          message,
        });
        const { summary, tabs } = get();
        const tab = tabs.find((t) => t.id === request.tab);
        const action = paletteAction({
          key: request.item,
        });
        if (mine !== get().session || summary === null)
          return Promise.resolve(fail(NO_PROJECT_ADD));
        if (readOnly()) return Promise.resolve(fail(READ_ONLY_REFUSAL));
        if (tab === undefined || tab.kind !== "workflow")
          return Promise.resolve(fail(FILE_TAB_ADD));
        if (action === null) return Promise.resolve(fail(NO_ACTION_ADD));
        addsPending++;
        return enqueue(async () => {
          try {
            const fresh = await engine()
              .freshName({ kind: action.kind, caller: tab.path })
              .catch((error: unknown) => refusal("internal", messageOf(error)));
            if ("ok" in fresh) return fail(fresh.message);
            const group = `palette-${mine}-${++adds}`;
            const label = `Add ${action.kind} ${fresh.name}`;
            const key = formatNodeKey({
              path: tab.path,
              workflow: tab.workflow,
              local: {
                kind: "unassigned",
                callee: fresh.name,
                occurrence: 1,
              },
            });
            pendingPlacement =
              request.at === null
                ? null
                : { session: mine, tab: tab.id, key, at: request.at };
            const refused = (outcome: EngineRefusal): PaletteAddOutcome => {
              pendingPlacement = null;
              return fail(
                `Couldn't add ${fresh.name}: ${outcome.message} Nothing was changed.`,
              );
            };
            const applied = await applyGroup(
              mine,
              group,
              [
                {
                  kind:
                    action.kind === "process"
                      ? "createProcess"
                      : "createWorkflow",
                  name: fresh.name,
                  caller: tab.path,
                },
                {
                  kind: "addCall",
                  target: { path: tab.path, workflow: tab.workflow },
                  callee: fresh.name,
                },
              ],
              label,
            );
            if (!applied.ok) return refused(applied);
            await get().select(key);
            return { ok: true, name: fresh.name, path: fresh.path, node: key };
          } finally {
            addsPending--;
          }
        });
      },

      editDeclaration(request, session) {
        const mine = session ?? get().session;
        const { target, form } = request;
        const fail = (
          message: string,
          fields: readonly FieldProblem[] = [],
        ): EditOutcome => ({ ok: false, message, fields });
        if (mine !== get().session || get().summary === null)
          return Promise.resolve(fail(NO_PROJECT_EDIT));
        if (readOnly()) return Promise.resolve(fail(READ_ONLY_REFUSAL));
        return enqueue(async () => {
          if (get().summary?.revision !== request.revision)
            return fail(
              `${target.name} changed since the popup opened. Close it and open it again.`,
            );
          const renamed = form.name !== target.name;
          const commands: EditCommand[] = [
            {
              kind: "updateDeclaration",
              path: target.path,
              name: target.name,
              form,
            },
          ];
          if (renamed) {
            commands.push({
              kind: "renameDeclaration",
              path: target.path,
              name: target.name,
              newName: form.name,
            });
            const folder = moduleFolder(target.path, target.name);
            const newFolder = folderOf(form.name);
            // a case-only rename keeps the folder, and a folder that is taken stays where it is
            if (folder !== null && newFolder !== folder) {
              const [outline, taken] = await Promise.all([
                engine()
                  .outline(target.path)
                  .catch(() => null),
                engine()
                  .readFile(`${newFolder}/main.nf`)
                  .catch(() => null),
              ]);
              if (
                taken === null &&
                outline !== null &&
                !("ok" in outline) &&
                declaresOnly(outline.items, target.name)
              )
                commands.push({
                  kind: "moveFile",
                  path: folder,
                  newPath: newFolder,
                });
            }
          }
          const label = `Edit process ${form.name}`;
          const outcome = await applyGroup(
            mine,
            `popup-${mine}-${++edits}`,
            commands,
            label,
          );
          if (!outcome.ok)
            return fail(
              // a refusal that says so already isn't followed by it again
              /Nothing was changed\.$/.test(outcome.message)
                ? `Couldn't apply: ${outcome.message}`
                : `Couldn't apply: ${outcome.message} Nothing was changed.`,
              outcome.fields ?? [],
            );
          const node = nodeAfterRename(
            request.node,
            target.name,
            form.name,
            get().content,
          );
          await get().select(node);
          return { ok: true, node };
        });
      },

      addPlugin(request, session) {
        const mine = session ?? get().session;
        const fail = (message: string): PluginAddOutcome => ({
          ok: false,
          message,
        });
        const { summary } = get();
        if (mine !== get().session || summary === null)
          return Promise.resolve(fail(NO_PROJECT_ADD));
        if (readOnly()) return Promise.resolve(fail(READ_ONLY_REFUSAL));
        const { id, version } = request;
        return enqueue(async () => {
          await flushPending();
          const group = `plugin-${mine}-${++adds}`;
          const label = `Add plugin ${id}@${version}`;
          const refused = (outcome: EngineRefusal): PluginAddOutcome =>
            fail(`Couldn't add ${id}: ${outcome.message} Nothing was changed.`);
          const missing = !get().summary?.files.some(
            (f) => f.path === CONFIG_PATH,
          );
          if (missing) {
            const creating = await sendNow(
              mine,
              (revision) =>
                safely(() =>
                  engine().apply(
                    { kind: "createFile", path: CONFIG_PATH },
                    revision,
                    { group, label },
                  ),
                ) as Promise<ApplyOutcome>,
              afterApply,
            );
            if (!creating.ok) return refused(creating);
          }
          const adding = await sendNow(
            mine,
            async (revision) => {
              try {
                return await engine().apply(
                  {
                    kind: "addConfigPlugin",
                    path: CONFIG_PATH,
                    id: `${id}@${version}`,
                  },
                  revision,
                  { group, label },
                );
              } catch (error) {
                return refusal("internal", messageOf(error));
              }
            },
            afterApply,
          );
          if (!adding.ok) {
            if (missing) await discardFirstPart(mine);
            return refused(adding);
          }
          return { ok: true, id, version };
        });
      },

      connect: (from, to, session) =>
        rewire(
          "connect",
          (target) => ({ kind: "connect", target, from, to }),
          session,
        ),

      disconnect: (port, session) =>
        rewire(
          "disconnect",
          (target) => ({ kind: "disconnect", target, port }),
          session,
        ),

      async connectionTargets(from, session) {
        const mine = session ?? get().session;
        const tab = workflowTab();
        if (mine !== get().session || tab === undefined || readOnly())
          return null;
        try {
          const result = await engine().connectionTargets({
            path: tab.path,
            workflow: tab.workflow,
            from,
          });
          if ("ok" in result) return null;
          // a newer revision or project, or another tab, makes the answer stale
          if (
            mine !== get().session ||
            workflowTab()?.id !== tab.id ||
            result.revision !== get().summary?.revision
          )
            return null;
          return result.targets;
        } catch {
          return null;
        }
      },
    };
  });
}

export const canvasStore = createCanvasStore(getEngine, isReadOnly);
onEngineChange((change) => void canvasStore.getState().changed(change));

export function useWorkspace<T>(
  selector: (state: WorkspaceState & WorkspaceActions) => T,
): T {
  return useStore(canvasStore, selector);
}
