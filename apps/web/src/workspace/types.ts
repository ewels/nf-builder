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
}

/** One file write: a `null` text deletes the file. */
export interface FileChange {
  readonly projectId: string;
  readonly path: string;
  readonly text: string | null;
}

export type SaveStatus = "saved" | "saving" | "failed";

export interface SaveState {
  readonly status: SaveStatus;
  readonly error: string | null;
}

export interface OpeningState {
  readonly project: ProjectMeta;
  readonly progress: LoadProgress | null;
}

export interface WorkspaceStatus {
  readonly storage: "starting" | "ready" | "unavailable";
  readonly storageError: string | null;
  readonly projects: readonly ProjectMeta[];
  readonly current: ProjectMeta | null;
  readonly opening: OpeningState | null;
  readonly openError: {
    readonly project: ProjectMeta;
    readonly message: string;
  } | null;
  readonly save: SaveState;
}

export interface WorkspaceApi extends EngineApi {
  watch(listener: (status: WorkspaceStatus) => void): Promise<WorkspaceStatus>;
  createProject(input: NewProject): Promise<ProjectMeta>;
  openProject(id: string): Promise<ProjectSummary>;
  renameProject(id: string, name: string): Promise<ProjectMeta>;
  deleteProject(id: string): Promise<void>;
  flush(): Promise<SaveState>;
}
