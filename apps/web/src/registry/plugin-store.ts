// The plugin store (F-505, IO-33, FI-01): the page's copy of the plugins the root `nextflow.config` declares and their
// specs. The engine says which plugins are declared at each revision; the specs come from the registry snapshot, read
// here in the document (ADR 0050), and their config scopes go back to the worker so the config editor and the
// `config-unknown-option` warning know the plugins' options. The engine and the registry are injected for tests.
import {
  type DeclaredPlugin,
  type EngineApi,
  type PluginScopes,
  pluginConfigNodes,
  pluginsKey,
} from "@nf-builder/engine";
import {
  createSnapshotClient,
  type RegistryClient,
  toFailure,
} from "@nf-builder/sources";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  canvasStore,
  type WorkspaceActions,
  type WorkspaceState,
} from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";

/** A plugin spec as the snapshot holds it. */
export type PluginSpec = Awaited<ReturnType<RegistryClient["plugin"]>>;

export interface LoadedPlugin {
  readonly id: string;
  /** The version of `spec`: the declared one when the snapshot has it, else the snapshot's release. */
  readonly version: string;
  /** The declared version isn't the one `spec` is from. */
  readonly approximate: boolean;
  readonly spec: PluginSpec;
}

export interface PluginSpecState {
  /** The revision `declared` was read at; null before the first read. */
  readonly revision: number | null;
  readonly declared: readonly DeclaredPlugin[];
  /** Declared plugins the snapshot has a spec for, in source order. */
  readonly specs: readonly LoadedPlugin[];
  /** Declared plugins whose spec could not be read. */
  readonly failures: readonly {
    readonly id: string;
    readonly message: string;
  }[];
  /** The `id@version` list of `specs`; the worker's scopes are those of this key. */
  readonly pluginsKey: string;
}

const EMPTY: PluginSpecState = {
  revision: null,
  declared: [],
  specs: [],
  failures: [],
  pluginsKey: "",
};

export function createPluginStore(options: {
  engine: () => Pick<EngineApi, "plugins" | "setPluginScopes">;
  workspace: StoreApi<WorkspaceState & WorkspaceActions>;
  registry: () => Pick<RegistryClient, "index" | "plugin">;
  /** Defers a pull by one macrotask, so the canvas store's own requests reach the worker first. */
  schedule?: (fn: () => void) => void;
}): StoreApi<PluginSpecState> {
  const { engine, workspace, registry } = options;
  const schedule = options.schedule ?? ((fn) => void setTimeout(fn, 0));
  return createStore<PluginSpecState>()((set, get) => {
    let inFlight = false;
    let again = false;
    let session = -1;
    /** The key the worker holds: empty after a project opens. */
    let sentKey = "";
    /** Specs read, by `id@version`: a failed read isn't kept. */
    const read = new Map<string, PluginSpec>();

    async function pull(): Promise<void> {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        do {
          again = false;
          const start = workspace.getState();
          if (start.summary === null) break;
          const mine = start.session;
          const stale = () => {
            const now = workspace.getState();
            return (
              now.session !== mine ||
              now.summary?.revision !== start.summary?.revision
            );
          };
          const result = await engine().plugins();
          if ("ok" in result) break;
          if (stale()) {
            again = true;
            continue;
          }
          const specs: LoadedPlugin[] = [];
          const failures: { id: string; message: string }[] = [];
          if (result.plugins.length > 0) {
            const wanted = new Map(result.plugins.map((p) => [p.id, p]));
            const client = registry();
            try {
              const index = await client.index();
              await Promise.all(
                [...wanted.values()].map(async (declared) => {
                  const listed = index.plugins.find(
                    (p) => p.id === declared.id,
                  );
                  if (!listed || listed.definitions === 0) return;
                  try {
                    const at = `${declared.id}@${listed.version}`;
                    const spec =
                      read.get(at) ??
                      (await client.plugin(declared.id, listed.version));
                    read.set(at, spec);
                    specs.push({
                      id: declared.id,
                      version: listed.version,
                      approximate: declared.version !== listed.version,
                      spec,
                    });
                  } catch (error) {
                    failures.push({
                      id: declared.id,
                      message: toFailure(error).message,
                    });
                  }
                }),
              );
            } catch (error) {
              const message = toFailure(error).message;
              for (const id of wanted.keys()) failures.push({ id, message });
            }
          }
          const order = [...result.plugins.map((p) => p.id)];
          const byDeclared = <T extends { id: string }>(a: T, b: T) =>
            order.indexOf(a.id) - order.indexOf(b.id);
          specs.sort(byDeclared);
          failures.sort(byDeclared);
          if (stale()) {
            again = true;
            continue;
          }
          const scopes: PluginScopes[] = specs.map((s) => ({
            id: s.id,
            version: s.version,
            nodes: pluginConfigNodes(s.spec),
          }));
          const key = pluginsKey(scopes);
          if (key !== sentKey) {
            await engine().setPluginScopes(scopes);
            sentKey = key;
          }
          if (workspace.getState().session === mine)
            set({
              revision: result.revision,
              declared: result.plugins,
              specs,
              failures,
              pluginsKey: key,
            });
        } while (again);
      } catch {
        // the palette and the editor go on without plugin specs
      } finally {
        inFlight = false;
      }
    }

    const follow = (state: WorkspaceState): void => {
      if (state.session !== session) {
        session = state.session;
        sentKey = "";
        set(EMPTY);
      }
      const revision = state.summary?.revision ?? null;
      if (revision !== null && get().revision !== revision)
        schedule(() => void pull());
    };
    // the first state comes after the initialiser returns
    queueMicrotask(() => {
      workspace.subscribe(follow);
      follow(workspace.getState());
    });

    return EMPTY;
  });
}

const snapshotUrl = () =>
  new URL(`${import.meta.env.BASE_URL}registry/`, window.location.href).href;

let client: RegistryClient | null = null;

export const pluginStore = createPluginStore({
  engine: getEngine,
  workspace: canvasStore,
  registry: () => {
    client ??= createSnapshotClient({ snapshotUrl: snapshotUrl() });
    return client;
  },
});

export function usePlugins<T>(selector: (state: PluginSpecState) => T): T {
  return useStore(pluginStore, selector);
}
