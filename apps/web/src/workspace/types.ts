// Shared shapes of the workspace (F-202): stored records, the autosave state and the status the worker pushes to the page.
// Everything is plain data, so it survives structuredClone (ADR 0003).
import type {
  EngineApi,
  LoadProgress,
  ProjectFile,
  ProjectSummary,
} from "@nf-builder/engine";

/** A project record as stored in IndexedDB (schema v1). Times are milliseconds since the epoch. */
export interface ProjectMeta {
  readonly id: string;
  readonly name: string;
  readonly languageVersion: string;
  readonly createdAt: number;
  /** Changes on every save and rename. */
  readonly updatedAt: number;
  /** Changes on every open; the most recent project is reopened after a reload. */
  readonly openedAt: number;
}

export interface NewProject {
  readonly name: string;
  readonly languageVersion: string;
  readonly files: readonly ProjectFile[];
  /** A template id from the pack, or the engine's `BLANK_TEMPLATE` (F-203): the project starts with that template's files, so `files` must be empty. */
  readonly template?: string;
  /** The Publish docs to GitHub Pages choice (UX-60). Carried with the request; it has no effect until F-606. */
  readonly publishDocs?: boolean;
}

/** One file write: a `null` text deletes the file. */
export interface FileChange {
  readonly projectId: string;
  readonly path: string;
  readonly text: string | null;
}

export interface SaveState {
  readonly status: "saved" | "saving" | "failed";
  readonly error: string | null;
}

export interface WorkspaceStatus {
  readonly storage: "starting" | "ready" | "unavailable";
  readonly storageError: string | null;
  readonly projects: readonly ProjectMeta[];
  readonly current: ProjectMeta | null;
  readonly opening: {
    readonly project: ProjectMeta;
    readonly progress: LoadProgress | null;
  } | null;
  readonly openError: {
    readonly project: ProjectMeta;
    readonly message: string;
  } | null;
  readonly save: SaveState;
}

/** The status before the database has opened, on both sides of the bridge. */
export const INITIAL_STATUS: WorkspaceStatus = {
  storage: "starting",
  storageError: null,
  projects: [],
  current: null,
  opening: null,
  openError: null,
  save: { status: "saved", error: null },
};

export interface WorkspaceApi extends EngineApi {
  watch(listener: (status: WorkspaceStatus) => void): Promise<WorkspaceStatus>;
  createProject(input: NewProject): Promise<ProjectMeta>;
  openProject(id: string): Promise<ProjectSummary>;
  renameProject(id: string, name: string): Promise<ProjectMeta>;
  deleteProject(id: string): Promise<void>;
  flush(): Promise<SaveState>;
}
