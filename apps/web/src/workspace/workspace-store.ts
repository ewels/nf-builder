// The workspace store (F-205, AR-30): the open project's summary, its workflow tabs and the active tab's projection, the
// UI's read-only copy. The engine is injected so tests use a fake; `workspaceStore` uses the worker-backed one.
import type {
  EngineApi,
  OpenRequest,
  Projection,
  ProjectSummary,
  WorkflowRef,
} from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { getEngine } from "../engine/engine-client";

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

export interface WorkspaceState {
  readonly opening: boolean;
  readonly summary: ProjectSummary | null;
  readonly tabs: readonly WorkflowTab[];
  readonly activeTab: string | null;
  readonly content: CanvasContent;
  /** Session only (F-205 open point 11). */
  readonly portLabels: boolean;
  readonly error: string | null;
}

export interface WorkspaceActions {
  open(request: OpenRequest): Promise<ProjectSummary>;
  openWorkflow(path: string, workflow: string | null): Promise<void>;
  selectTab(id: string): Promise<void>;
  setPortLabels(value: boolean): void;
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

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createWorkspaceStore(
  engine: () => EngineApi,
): StoreApi<WorkspaceState & WorkspaceActions> {
  return createStore<WorkspaceState & WorkspaceActions>()((set, get) => {
    // a result for a superseded tab or project is dropped
    let generation = 0;

    async function load(tab: WorkflowTab): Promise<void> {
      const mine = ++generation;
      set({ activeTab: tab.id, content: { status: "loading" } });
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

    return {
      opening: false,
      summary: null,
      tabs: [],
      activeTab: null,
      content: EMPTY,
      portLabels: true,
      error: null,

      async open(request) {
        generation++;
        set({ opening: true, error: null });
        let summary: ProjectSummary;
        try {
          summary = await engine().open(request);
        } catch (error) {
          set({ opening: false, error: messageOf(error) });
          throw error;
        }
        const first = defaultWorkflow(summary.workflows);
        const tab = first === null ? null : tabFor(first);
        set({
          opening: false,
          summary,
          tabs: tab === null ? [] : [tab],
          activeTab: null,
          content: EMPTY,
        });
        if (tab !== null) await load(tab);
        return summary;
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
    };
  });
}

export const workspaceStore = createWorkspaceStore(getEngine);

export function useWorkspace<T>(
  selector: (state: WorkspaceState & WorkspaceActions) => T,
): T {
  return useStore(workspaceStore, selector);
}
