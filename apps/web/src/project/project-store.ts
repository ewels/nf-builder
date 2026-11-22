// The main-thread project store (F-202): it mirrors the workspace status pushed from the worker and runs the storage checks
// of IO-03. Nothing starts at import. Storage trouble (no API, a refusal, an unreachable worker) shows up as state, never
// as an exception, so the app also works in a cross-origin frame (ADR 0044).
import { installedPackVersions } from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { getEngine } from "../engine/engine-client";
import { requestPaletteView } from "../palette/use-palette-view";
import type { WorkspaceApi, WorkspaceStatus } from "../workspace/types";
import {
  nearQuota,
  requestPersistence,
  type StorageUsage,
  storageUsage,
} from "./storage-health";

export interface ProjectUiState {
  readonly status: WorkspaceStatus;
  /** Set while usage is at or above the warning fraction. */
  readonly storageWarning: StorageUsage | null;
  /** Whether the browser granted persistent storage: null until asked or when unsupported, false when refused. */
  readonly persisted: boolean | null;
}

export interface ProjectActions {
  start(): Promise<void>;
  create(name: string): Promise<void>;
  open(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ProjectStoreDeps {
  readonly workspace: () => WorkspaceApi;
  readonly palette: (version: string) => Promise<unknown>;
  readonly storage: () => StorageManager | undefined;
  readonly languageVersion: string | undefined;
}

export const INITIAL_STATUS: WorkspaceStatus = {
  storage: "starting",
  storageError: null,
  projects: [],
  current: null,
  opening: null,
  openError: null,
  save: { status: "saved", error: null },
};

export function createProjectStore(
  deps: ProjectStoreDeps,
): StoreApi<ProjectUiState & ProjectActions> {
  const storage = (): StorageManager | undefined => {
    try {
      return deps.storage();
    } catch {
      return undefined; // reading navigator.storage can throw in a sandboxed frame
    }
  };

  return createStore<ProjectUiState & ProjectActions>()((set, get) => {
    let checks = 0;
    const checkUsage = async () => {
      const id = ++checks;
      const usage = await storageUsage(storage());
      if (id === checks)
        set({ storageWarning: nearQuota(usage) ? usage : null });
    };
    const askPersistence = async () => {
      const granted = await requestPersistence(storage());
      if (granted !== null) set({ persisted: granted });
    };
    const onStatus = (status: WorkspaceStatus) => {
      const savedNow =
        get().status.save.status === "saving" && status.save.status === "saved";
      set({ status });
      if (savedNow) {
        void askPersistence();
        void checkUsage();
      }
    };

    return {
      status: INITIAL_STATUS,
      storageWarning: null,
      persisted: null,

      async start() {
        try {
          // the palette goes first: the worker's queue is serial and a long open would delay it (ADR 0029)
          if (deps.languageVersion !== undefined)
            await deps.palette(deps.languageVersion).catch(() => undefined);
          const workspace = deps.workspace();
          const initial = await workspace.watch(onStatus);
          set({ status: initial });
          void checkUsage();
          const first = initial.projects[0];
          if (first && !initial.current && !initial.opening)
            await workspace.openProject(first.id).catch(() => undefined); // the status carries `openError`
        } catch (error) {
          set({
            status: {
              ...get().status,
              storage: "unavailable",
              storageError:
                error instanceof Error ? error.message : String(error),
            },
          });
        }
      },

      async create(name) {
        if (deps.languageVersion === undefined)
          throw new Error("No Nextflow version is installed.");
        const workspace = deps.workspace();
        const meta = await workspace.createProject({
          name,
          languageVersion: deps.languageVersion,
          files: [],
        });
        void askPersistence();
        void checkUsage();
        await workspace.openProject(meta.id);
      },

      async open(id) {
        await deps.workspace().openProject(id);
      },

      async rename(id, name) {
        await deps.workspace().renameProject(id, name);
      },

      async remove(id) {
        await deps.workspace().deleteProject(id);
        void checkUsage();
      },
    };
  });
}

let store: StoreApi<ProjectUiState & ProjectActions> | undefined;

function projectStore() {
  store ??= createProjectStore({
    workspace: getEngine,
    palette: requestPaletteView,
    storage: () =>
      typeof navigator === "undefined" ? undefined : navigator.storage,
    languageVersion: installedPackVersions()[0],
  });
  return store;
}

export function useProjects<T>(
  selector: (state: ProjectUiState & ProjectActions) => T,
): T {
  return useStore(projectStore(), selector);
}

/** Starts the workspace once from `main.tsx`. */
export function startProjects(): void {
  void projectStore().getState().start();
}
