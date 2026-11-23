// The canvas store (F-205, AR-30): the open project's summary, its workflow tabs and the active tab's projection, the
// UI's read-only copy. The engine is injected so tests use a fake; `canvasStore` uses the worker-backed one. The project
// store (F-202) opens stored projects in the worker and hands the summary to `show`; `open` is the test hook's raw open.
import type {
  ApplyOutcome,
  EditCommand,
  EngineApi,
  NodeDetails,
  OpenRequest,
  ProjectChange,
  Projection,
  ProjectSummary,
  WorkflowRef,
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
  apply(command: EditCommand, session?: number): Promise<ApplyOutcome>;
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
        });
      },

      async changed(change) {
        const { summary, tabs, activeTab } = get();
        if (summary === null) return;
        set({
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

      async apply(command, session) {
        const { summary } = get();
        if (session !== undefined && session !== get().session)
          return {
            ok: false,
            revision: null,
            code: "no-project",
            message: "The project changed.",
            path: null,
            problems: [],
          };
        if (summary === null)
          return {
            ok: false,
            revision: null,
            code: "no-project",
            message: "No project is open.",
            path: null,
            problems: [],
          };
        const outcome = await engine().apply(command, summary.revision);
        const now = get().summary;
        if (now === null) return outcome;
        if (outcome.ok) {
          // the engine client announces changes to `changed` already; this covers an engine that doesn't
          if (outcome.revision > now.revision) await get().changed(outcome);
        } else if (
          outcome.revision !== null &&
          outcome.revision > now.revision
        ) {
          // another writer got in first: adopt its revision and show what it left
          set({ summary: { ...now, revision: outcome.revision } });
          const active = get().tabs.find((t) => t.id === get().activeTab);
          if (active !== undefined) await load(active, true);
        }
        return outcome;
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
