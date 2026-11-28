// The config store (F-601, AR-30): the page's read-only copy of each open config tab's view, pulled from the engine once
// per revision, and the tabs' session-only state (selection, collapsed cards). The engine is injected so tests use a fake.
import type {
  ConfigSchema,
  ConfigView,
  EngineApi,
  OptionRow,
} from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  canvasStore,
  type WorkspaceActions,
  type WorkspaceState,
} from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";
import { isReadOnly } from "../read-only/read-only-store";

export interface ConfigTabState {
  readonly status: "loading" | "ready" | "failed";
  /** The revision `view` was made at. */
  readonly revision: number | null;
  readonly view: ConfigView | null;
  readonly message: string | null;
  /** The key of the selected row, card or selector, for the details pane. */
  readonly selected: string | null;
  /** The keys of cards whose collapsed state differs from their default: scope cards start open, and selector cards start collapsed in a process card of more than 20. */
  readonly toggled: readonly string[];
}

export interface ConfigState {
  readonly schema: ConfigSchema | null;
  readonly tabs: Readonly<Record<string, ConfigTabState>>;
}

export interface ConfigActions {
  /** Pulls the views of the open config tabs that are not at the current revision, and the schema once. */
  refresh(): Promise<void>;
  select(path: string, key: string | null): void;
  toggle(path: string, cardKey: string): void;
  /** Shows a range of the file in Split (F-309's reveal); nothing while the app is read-only. */
  editInCode(path: string, range: OptionRow["range"]): void;
}

const NEW_TAB: ConfigTabState = {
  status: "loading",
  revision: null,
  view: null,
  message: null,
  selected: null,
  toggled: [],
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createConfigStore(options: {
  engine: () => EngineApi;
  workspace: StoreApi<WorkspaceState & WorkspaceActions>;
  /** Defers a pull by one macrotask, so the canvas store's own requests reach the worker first. */
  schedule?: (fn: () => void) => void;
  readOnly?: () => boolean;
}): StoreApi<ConfigState & ConfigActions> {
  const { engine, workspace } = options;
  const readOnly = options.readOnly ?? isReadOnly;
  const schedule = options.schedule ?? ((fn) => void setTimeout(fn, 0));
  return createStore<ConfigState & ConfigActions>()((set, get) => {
    let inFlight = false;
    let again = false;
    let session = -1;

    const openPaths = (state: WorkspaceState): string[] =>
      state.tabs.filter((t) => t.kind === "config").map((t) => t.path);

    const update = (path: string, patch: Partial<ConfigTabState>): void =>
      set((s) => ({
        tabs: {
          ...s.tabs,
          [path]: { ...(s.tabs[path] ?? NEW_TAB), ...patch },
        },
      }));

    async function pull(): Promise<void> {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        do {
          again = false;
          const now = workspace.getState();
          const { summary } = now;
          if (summary === null) break;
          const mine = now.session;
          if (get().schema === null && openPaths(now).length > 0) {
            try {
              const schema = await engine().configSchema(summary.version);
              if (workspace.getState().session === mine) set({ schema });
            } catch {
              // the form still shows its rows; the details pane says there is no description
            }
          }
          for (const path of openPaths(workspace.getState())) {
            const state = workspace.getState();
            if (state.session !== mine || state.summary === null) break;
            const have = get().tabs[path];
            if (have?.revision === state.summary.revision) continue;
            let next: Partial<ConfigTabState>;
            try {
              const result = await engine().configView(path);
              if ("ok" in result)
                next = { status: "failed", message: result.message };
              else {
                const after = workspace.getState();
                // a result for another project or revision is dropped: the change that moved on pulls again
                if (
                  after.session !== mine ||
                  after.summary?.revision !== result.revision
                ) {
                  again = true;
                  continue;
                }
                next = {
                  status: "ready",
                  revision: result.revision,
                  view: result.view,
                  message: null,
                };
              }
            } catch (error) {
              next = { status: "failed", message: messageOf(error) };
            }
            if (workspace.getState().session === mine) update(path, next);
          }
        } while (again);
      } finally {
        inFlight = false;
      }
    }

    const follow = (state: WorkspaceState): void => {
      if (state.session !== session) {
        session = state.session;
        set({ schema: null, tabs: {} });
      }
      const revision = state.summary?.revision ?? null;
      if (revision === null) return;
      const tabs = get().tabs;
      let needed = false;
      for (const path of openPaths(state)) {
        const have = tabs[path];
        if (have === undefined) update(path, NEW_TAB);
        if (have?.revision !== revision) needed = true;
      }
      if (needed) schedule(() => void pull());
    };
    // the first state comes after the initialiser returns
    queueMicrotask(() => {
      workspace.subscribe(follow);
      follow(workspace.getState());
    });

    return {
      schema: null,
      tabs: {},

      refresh: pull,

      select(path, key) {
        update(path, { selected: key });
      },

      toggle(path, cardKey) {
        const toggled = get().tabs[path]?.toggled ?? [];
        update(path, {
          toggled: toggled.includes(cardKey)
            ? toggled.filter((k) => k !== cardKey)
            : [...toggled, cardKey],
        });
      },

      editInCode(path, range) {
        if (readOnly()) return;
        const ws = workspace.getState();
        ws.setMode(`config:${path}`, "split");
        ws.revealCode(path, range);
      },
    };
  });
}

export const configStore = createConfigStore({
  engine: getEngine,
  workspace: canvasStore,
});

export function useConfig<T>(
  selector: (state: ConfigState & ConfigActions) => T,
): T {
  return useStore(configStore, selector);
}
