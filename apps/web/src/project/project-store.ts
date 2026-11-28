// The main-thread project store (F-202): it mirrors the workspace status pushed from the worker and runs the storage checks
// of IO-03. Nothing starts at import. Storage trouble (no API, a refusal, an unreachable worker) shows up as state, never
// as an exception, so the app also works in a cross-origin frame (ADR 0044).
import { installedPackVersions, type ProjectSummary } from "@nf-builder/engine";
import type { ImportPlan } from "@nf-builder/sources";
import { type GithubClient, repoSlug } from "@nf-builder/sources/github";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { canvasStore } from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";
import {
  download,
  githubClient,
  type Review,
  skippedWithNotText,
} from "../import/github-import";
import type { ImportReport } from "../import/import-report-dialog";
import { requestPaletteView } from "../palette/use-palette-view";
import { isReadOnly, READ_ONLY_REFUSAL } from "../read-only/read-only-store";
import {
  INITIAL_STATUS,
  type WorkspaceApi,
  type WorkspaceStatus,
} from "../workspace/types";
import { downloadBytes } from "./download";
import type { NewProjectRequest, NewProjectRoute } from "./new-project-dialog";
import {
  nearQuota,
  requestPersistence,
  type StorageUsage,
  storageUsage,
} from "./storage-health";
import { requestTemplates } from "./templates";

/** The dialog that is open, if any; it lives here so the header can open it (F-203). */
export type ProjectDialog =
  | { readonly kind: "new"; readonly route: NewProjectRoute }
  | { readonly kind: "rename" }
  | { readonly kind: "delete" }
  | { readonly kind: "export" };

interface ProjectUiState {
  readonly dialog: ProjectDialog | null;
  /** The element that had focus when the dialog was requested; focus returns to it on close (QA-10, WCAG 2.4.3). */
  readonly opener: HTMLElement | null;
  readonly status: WorkspaceStatus;
  /** Set while usage is at or above the warning fraction. */
  readonly storageWarning: StorageUsage | null;
  /** Whether the browser granted persistent storage: null until asked or when unsupported, false when refused. */
  readonly persisted: boolean | null;
  /** The report of the last GitHub import, shown once and then dropped (session-only, F-401). */
  readonly importReport: ImportReport | null;
}

/** What a GitHub import needs once the user has reviewed the repository. */
export interface GithubImportRun {
  readonly name: string;
  readonly languageVersion: string;
  readonly review: Review;
  readonly plan: ImportPlan;
}

interface ProjectActions {
  start(): Promise<void>;
  create(request: NewProjectRequest): Promise<void>;
  showDialog(dialog: ProjectDialog): void;
  closeDialog(): void;
  open(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Downloads the planned files, stores the project with its source, opens it and builds the report (F-401). */
  importGithub(
    run: GithubImportRun,
    o: { signal: AbortSignal; onProgress(done: number, total: number): void },
  ): Promise<void>;
  closeImportReport(): void;
  /** Flushes pending code edits, zips the project and downloads it; throws the refusal's message (F-404, IO-20). */
  exportProject(layout: boolean): Promise<void>;
}

export interface ProjectStoreDeps {
  readonly workspace: () => WorkspaceApi;
  readonly github: () => GithubClient;
  readonly palette: (version: string) => Promise<unknown>;
  /** The template list, requested up front like the palette so the New project dialog finds it ready (F-203). */
  readonly templates: (version: string) => Promise<unknown>;
  readonly storage: () => StorageManager | undefined;
  /** Whether the app is read-only (F-703, UX-04); create, rename, delete and GitHub import are refused then. Default: the page's mode. */
  readonly readOnly?: () => boolean;
  /** Saves bytes as a file; default: a download link (F-404). */
  readonly download?: (bytes: Uint8Array, fileName: string) => void;
  /** Applies Code-view text that is still pending; default: the canvas store's (F-404). */
  readonly flushEdits?: () => Promise<void>;
  readonly languageVersion: string | undefined;
  /** The canvas (F-205): shown every project the worker opens, and told when the stored project is gone. */
  readonly canvas: {
    show(summary: ProjectSummary): Promise<void>;
    projectGone(): void;
  };
}

export function createProjectStore(
  deps: ProjectStoreDeps,
): StoreApi<ProjectUiState & ProjectActions> {
  const readOnly = deps.readOnly ?? isReadOnly;
  const refuseWhenReadOnly = (): void => {
    if (readOnly()) throw new Error(READ_ONLY_REFUSAL);
  };
  const storage = (): StorageManager | undefined => {
    try {
      return deps.storage();
    } catch {
      return undefined; // reading navigator.storage can throw in a sandboxed frame
    }
  };

  return createStore<ProjectUiState & ProjectActions>()((set, get) => {
    let checks = 0;
    let newest = 0; // the highest status `seq` applied or reported by an open
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
      if (status.seq < newest) return; // overtaken: an older push arriving after a newer one
      newest = status.seq;
      const savedNow =
        get().status.save.status === "saving" && status.save.status === "saved";
      set({ status });
      // a status sent while a project opens can arrive after that open's summary; it must not clear the canvas
      if (status.current === null && status.opening === null)
        deps.canvas.projectGone();
      if (savedNow) {
        void askPersistence();
        void checkUsage();
      }
    };

    /** Opens a stored project in the worker, then shows it on the canvas. */
    const openAndShow = async (id: string) => {
      const { summary, seq } = await deps.workspace().openProject(id);
      // the reply is newer than any status pushed before it, even one still on its way
      newest = Math.max(newest, seq);
      void deps.canvas.show(summary).catch(() => undefined);
    };

    return {
      dialog: null,
      opener: null,
      status: INITIAL_STATUS,
      storageWarning: null,
      persisted: null,
      importReport: null,

      async start() {
        try {
          // the palette request goes first: the worker's queue is serial and a long open would delay it (ADR 0029)
          if (deps.languageVersion !== undefined)
            void deps.palette(deps.languageVersion).catch(() => undefined);
          if (deps.languageVersion !== undefined)
            void deps.templates(deps.languageVersion).catch(() => undefined);
          const workspace = deps.workspace();
          const initial = await workspace.watch(onStatus);
          if (initial.seq >= newest) {
            newest = initial.seq;
            set({ status: initial });
          }
          void checkUsage();
          const first = initial.projects[0];
          if (first && !initial.current && !initial.opening)
            await openAndShow(first.id).catch(() => undefined); // the status carries `openError`
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

      showDialog(dialog) {
        // read before the dialog mounts: its own effects move focus into it
        const active =
          typeof document === "undefined" ? null : document.activeElement;
        set({
          dialog,
          opener:
            typeof HTMLElement !== "undefined" && active instanceof HTMLElement
              ? active
              : null,
        });
      },

      closeDialog() {
        set({ dialog: null });
      },

      async create(request) {
        refuseWhenReadOnly();
        const workspace = deps.workspace();
        const meta = await workspace.createProject({
          name: request.name,
          languageVersion: request.languageVersion,
          files: [],
          template: request.template,
          import: request.import,
          publishDocs: request.publishDocs,
        });
        void askPersistence();
        void checkUsage();
        await openAndShow(meta.id);
      },

      async open(id) {
        await openAndShow(id);
      },

      async importGithub(run, o) {
        refuseWhenReadOnly();
        const files = await download(deps.github(), run.review, run.plan, o);
        const workspace = deps.workspace();
        const { input, listing } = run.review;
        const source = {
          kind: "github",
          repo: repoSlug(input.repo),
          ref: input.ref,
          sha: listing.sha,
        } as const;
        const { meta, skipped } = await workspace.importProject({
          name: run.name,
          languageVersion: run.languageVersion,
          source,
          files,
        });
        void askPersistence();
        void checkUsage();
        await openAndShow(meta.id);
        let project: ImportReport["project"];
        try {
          const report = await workspace.report();
          project = "ok" in report ? { error: report.message } : report;
        } catch (failure) {
          project = {
            error: failure instanceof Error ? failure.message : String(failure),
          };
        }
        set({
          importReport: {
            source,
            projectName: meta.name,
            imported: files.length - skipped.length,
            skipped: skippedWithNotText(
              run.plan,
              skipped.map((f) => f.path),
            ),
            project,
          },
        });
      },

      closeImportReport() {
        set({ importReport: null });
      },

      async exportProject(layout) {
        await (
          deps.flushEdits ?? (() => canvasStore.getState().flushEdits())
        )();
        const result = await deps.workspace().exportProject({ layout });
        if (!result.ok) throw new Error(result.message);
        (deps.download ?? downloadBytes)(result.bytes, result.fileName);
      },

      async rename(id, name) {
        refuseWhenReadOnly();
        await deps.workspace().renameProject(id, name);
      },

      async remove(id) {
        refuseWhenReadOnly();
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
    github: githubClient,
    palette: requestPaletteView,
    templates: requestTemplates,
    storage: () =>
      typeof navigator === "undefined" ? undefined : navigator.storage,
    languageVersion: installedPackVersions()[0],
    canvas: {
      show: (summary) => canvasStore.getState().show(summary),
      projectGone: () => canvasStore.getState().projectGone(),
    },
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

/** Closes whichever project dialog is open: read-only mode starts with none (F-703). */
export function closeProjectDialog(): void {
  projectStore().getState().closeDialog();
}
