// The canvas store (F-205, AR-30): the open project's summary, its workflow tabs and the active tab's projection, the
// UI's read-only copy. The engine is injected so tests use a fake; `canvasStore` uses the worker-backed one. The project
// store (F-202) opens stored projects in the worker and hands the summary to `show`; `open` is the test hook's raw open.
import type {
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

export interface WorkflowTab {
  /** `<path>#<workflow>`, the empty name for the entry workflow (the projection key prefix, ADR 0036). */
  readonly id: string;
  readonly path: string;
  /** Null for the entry workflow. */
  readonly workflow: string | null;
  readonly label: string;
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
  readonly summary: ProjectSummary | null;
  readonly tabs: readonly WorkflowTab[];
  readonly activeTab: string | null;
  readonly content: CanvasContent;
  /** Session only (F-205 open point 11). */
  readonly portLabels: boolean;
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
  setPortLabels(value: boolean): void;
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
      if (mine === generation) set({ content });
    }

    async function loadDetails(id: string): Promise<void> {
      const { tabs, activeTab, content } = get();
      const tab = tabs.find((t) => t.id === activeTab);
      if (tab === undefined || content.status !== "ready") return;
      const mine = ++selection;
      set({ selected: id, details: { status: "loading", node: id } });
      let details: DetailsContent;
      try {
        const result = await engine().details(tab.path, tab.workflow, id);
        if (mine !== selection) return;
        if ("ok" in result)
          details = {
            status: "unavailable",
            node: id,
            message: result.message,
          };
        else if (result.details === null) {
          clearSelection();
          return;
        } else {
          const current = get().content;
          details =
            current.status === "ready" && current.revision === result.revision
              ? {
                  status: "ready",
                  node: id,
                  revision: result.revision,
                  details: result.details,
                }
              : {
                  status: "unavailable",
                  node: id,
                  message: "The project changed. Select the node again.",
                };
        }
      } catch (error) {
        if (mine !== selection) return;
        details = {
          status: "unavailable",
          node: id,
          message: messageOf(error),
        };
      }
      set({ details });
    }

    return {
      source: null,
      summary: null,
      tabs: [],
      activeTab: null,
      content: EMPTY,
      portLabels: true,
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
          summary,
          tabs: tab === null ? [] : [tab],
          activeTab: null,
          content: EMPTY,
        });
        if (tab !== null) await load(tab);
      },

      projectGone() {
        if (get().source !== "project") return;
        generation++;
        clearSelection();
        set({
          source: null,
          summary: null,
          tabs: [],
          activeTab: null,
          content: EMPTY,
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

      setPortLabels(portLabels) {
        set({ portLabels });
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
