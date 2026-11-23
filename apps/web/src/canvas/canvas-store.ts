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
  type Point,
  type Positions,
  type ProjectChange,
  type Projection,
  type ProjectSummary,
  type WorkflowRef,
} from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { getEngine, onEngineChange } from "../engine/engine-client";
import type { ViewMode } from "../views/view-mode";

export interface WorkflowTab {
  /** `<path>#<workflow>`, the empty name for the entry workflow (the projection key prefix, ADR 0036). */
  readonly id: string;
  readonly path: string;
  /** Null for the entry workflow. */
  readonly workflow: string | null;
  readonly label: string;
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
      /** The node positions: stored ones from the engine, then those placed and moved here (F-207). Whole nodes only. */
      readonly positions: Positions;
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
  /** Undoes the newest step (F-209). Pending code edits are sent first. Applies, undos and redos run one at a time. */
  undo(session?: number): Promise<HistoryOutcome>;
  redo(session?: number): Promise<HistoryOutcome>;
  /** A code pane registers its flush, awaited before an undo or redo; returns the unregister function. */
  registerFlush(flush: () => Promise<void>): () => void;
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
}

/** A layout run on the canvas: every node's position, and what to save (`saved`, merged, or replacing the workflow's entries). */
export interface Placement {
  readonly positions: Positions;
  readonly saved: Positions;
  readonly replace: boolean;
  readonly notice: string | null;
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

export function tabFor(ref: {
  readonly path: string;
  readonly name: string | null;
}): WorkflowTab {
  return {
    id: `${ref.path}#${ref.name ?? ""}`,
    path: ref.path,
    workflow: ref.name,
    label: ref.name ?? fileName(ref.path),
    mode: "graph",
  };
}

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

export function createCanvasStore(
  engine: () => EngineApi,
): StoreApi<WorkspaceState & WorkspaceActions> {
  return createStore<WorkspaceState & WorkspaceActions>()((set, get) => {
    // a result for a superseded tab or project is dropped
    let generation = 0;
    // a details result for a superseded selection is dropped
    let selection = 0;

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

    function clearSelection(): void {
      selection++;
      set({ selected: null, details: IDLE });
    }

    async function load(tab: WorkflowTab, quiet = false): Promise<void> {
      const mine = ++generation;
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
            notice: null,
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

    /** Saves `positions` for the active tab, and keeps the sidecar's status and any refusal where the canvas shows them. */
    async function save(
      tab: WorkflowTab,
      revision: number,
      positions: Positions,
      replace: boolean,
      retried = false,
    ): Promise<void> {
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

    async function stepHistory(
      kind: "undo" | "redo",
      session: number | undefined,
    ): Promise<HistoryOutcome> {
      // the project shown when the key was pressed, not whichever is shown once the flushes are done
      const mine = session ?? get().session;
      if (mine !== get().session)
        return refusal("no-project", "The project changed.");
      // pending code edits become the step that gets undone; outside the queue, as their send is queued itself
      await Promise.all([...flushes].map((flush) => flush().catch(() => {})));
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

      async open(request) {
        generation++;
        pendingMove = null;
        const summary = await engine().open(request);
        await get().show(summary, "unsaved");
        return summary;
      },

      async show(summary, source = "project") {
        generation++;
        pendingMove = null;
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
          layoutNotice: null,
          history: EMPTY_HISTORY,
          historyNotice: null,
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

      async openWorkflow(path, workflow) {
        const tab = tabFor({ path, name: workflow });
        if (!get().tabs.some((t) => t.id === tab.id))
          set({ tabs: [...get().tabs, tab] });
        await load(tab);
      },

      async selectTab(id) {
        const tab = get().tabs.find((t) => t.id === id);
        if (tab !== undefined) await load(tab);
      },

      setMode(tabId, mode) {
        set({
          tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, mode } : t)),
        });
      },

      setPortLabels(portLabels) {
        set({ portLabels });
      },

      apply: (command, session, options) =>
        send(
          session,
          (revision) => engine().apply(command, revision, options),
          async (outcome) => {
            await adoptNewer(outcome);
            // an internal refusal can follow a write that cleared the engine's history
            if (!outcome.ok && outcome.code === "internal")
              await refreshHistory();
          },
        ),

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

      async moveNodes(moves) {
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
        set({
          content: {
            ...content,
            positions: placement.positions,
            notice: placement.notice,
          },
        });
        if (placement.replace || Object.keys(placement.saved).length > 0)
          await save(tab, content.revision, placement.saved, placement.replace);
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
