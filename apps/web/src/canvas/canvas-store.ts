// The canvas store (F-205, AR-30): the open project's summary, its workflow tabs and the active tab's projection, the
// UI's read-only copy. The engine is injected so tests use a fake; `canvasStore` uses the worker-backed one. The project
// store (F-202) opens stored projects in the worker and hands the summary to `show`; `open` is the test hook's raw open.
import {
  type ApplyOptions,
  type ApplyOutcome,
  type EditCommand,
  EMPTY_HISTORY,
  type EngineApi,
  type EngineRefusal,
  type HistoryOutcome,
  type HistoryStatus,
  type NodeDetails,
  type OpenRequest,
  type ProjectChange,
  type Projection,
  type ProjectSummary,
  type QuickFix,
  type WorkflowRef,
} from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { getEngine, onEngineChange } from "../engine/engine-client";
import type { ViewMode } from "../views/view-mode";

export interface WorkflowTab {
  /** `<path>#<workflow>`, the empty name for the entry workflow (the projection key prefix, ADR 0036); `file:<path>` for a file tab. */
  readonly id: string;
  /** A workflow's canvas tab, or a code-only tab of a file (F-309, UX-20). */
  readonly kind: "workflow" | "file";
  readonly path: string;
  /** Null for the entry workflow. */
  readonly workflow: string | null;
  readonly label: string;
  /** The tooltip: the full path of a file tab. */
  readonly title?: string;
  /** The view mode of this tab, for the session (AR-30, UX-27). */
  readonly mode: ViewMode;
}

export type CanvasContent =
  | { readonly status: "empty" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly revision: number;
      readonly projection: Projection;
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
  /** Selects a node and loads its details; null clears the selection. */
  select(id: string | null): Promise<void>;
}

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
    mode: "code",
  };
}

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
  };
}

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

export function createCanvasStore(
  engine: () => EngineApi,
): StoreApi<WorkspaceState & WorkspaceActions> {
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

    function clearSelection(): void {
      selection++;
      set({ selected: null, details: IDLE });
    }

    async function load(tab: WorkflowTab, quiet = false): Promise<void> {
      const mine = ++generation;
      // a file tab has no projection: its code pane reads the file itself
      if (tab.kind === "file") {
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
          };
      } catch (error) {
        content = { status: "unavailable", message: messageOf(error) };
      }
      if (mine !== generation) return;
      set({ content });
      // no canvas, so no node to select (the header and the body agree)
      if (content.status !== "ready") clearSelection();
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
    function send<T extends ApplyOutcome | HistoryOutcome>(
      session: number | undefined,
      call: (revision: number) => Promise<T>,
      after: (outcome: T) => Promise<void> | void = adoptNewer,
    ): Promise<T | EngineRefusal> {
      return enqueue(async () => {
        const { summary } = get();
        if (session !== undefined && session !== get().session)
          return refusal("no-project", "The project changed.");
        if (summary === null)
          return refusal("no-project", "No project is open.");
        const outcome = await call(summary.revision);
        const now = get().summary;
        if (now === null) return outcome;
        // the engine client announces changes to `changed` already; this covers an engine that doesn't
        if (outcome.ok && outcome.revision > now.revision)
          await get().changed(outcome);
        await after(outcome);
        return outcome;
      });
    }

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

    /** Sends the code panes' pending edits; outside the queue, as their send is queued itself. */
    const flushPending = () =>
      Promise.all([...flushes].map((flush) => flush().catch(() => {})));

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
      history: EMPTY_HISTORY,
      historyNotice: null,
      reveal: null,
      focusNode: null,

      async open(request) {
        generation++;
        const summary = await engine().open(request);
        await get().show(summary, "unsaved");
        return summary;
      },

      async show(summary, source = "project") {
        generation++;
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
          history: EMPTY_HISTORY,
          historyNotice: null,
          reveal: null,
          focusNode: null,
        });
        if (tab !== null) await load(tab);
      },

      projectGone() {
        if (get().source !== "project") return;
        generation++;
        clearSelection();
        set({
          source: null,
          session: get().session + 1,
          summary: null,
          tabs: [],
          activeTab: null,
          content: EMPTY,
          lastChange: null,
          history: EMPTY_HISTORY,
          historyNotice: null,
          reveal: null,
          focusNode: null,
        });
      },

      async changed(change) {
        const { summary } = get();
        if (summary === null) return;
        // a workflow renamed (or renamed back) keeps its tab, and its view mode
        const renamed = renamedTabs(summary.workflows, change.workflows);
        // a stale tab that already holds a new id gives way to the renamed one
        const taken = new Set([...renamed.values()].map((w) => tabFor(w).id));
        const tabs = get()
          .tabs.filter((t) => renamed.has(t.id) || !taken.has(t.id))
          .map((t) => {
            const to = renamed.get(t.id);
            return to === undefined ? t : { ...tabFor(to), mode: t.mode };
          });
        const current = get().activeTab;
        const moved = current === null ? undefined : renamed.get(current);
        const activeTab = moved === undefined ? current : tabFor(moved).id;
        set({
          tabs,
          activeTab,
          history: change.history,
          historyNotice: null,
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
        if (active?.kind === "file") return;
        if (active !== undefined) {
          await load(active, true);
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
        await openTab(workflow === null ? fileTabFor(path) : tabFor(workflow));
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
            t.id === tabId && t.kind === "workflow" ? { ...t, mode } : t,
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

      async select(id) {
        if (id === null) {
          clearSelection();
          return;
        }
        const { selected, details } = get();
        if (id === selected && details.status !== "unavailable") return;
        await loadDetails(id);
      },
    };
  });
}

export const canvasStore = createCanvasStore(getEngine);
onEngineChange((change) => void canvasStore.getState().changed(change));

export function useWorkspace<T>(
  selector: (state: WorkspaceState & WorkspaceActions) => T,
): T {
  return useStore(canvasStore, selector);
}
