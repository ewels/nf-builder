// Shared shapes of the workspace (F-202): stored records, the autosave state and the status the worker pushes to the page.
// Everything is plain data, so it survives structuredClone (ADR 0003).
import type {
  AddConflict,
  EngineApi,
  EngineRefusal,
  LoadProgress,
  ProjectChange,
  ProjectFile,
  ProjectSummary,
} from "@nf-builder/engine";
import type { ImportRefusal, ImportSummary } from "@nf-builder/sources";

/** Where an imported project came from (IO-13, ADR 0057). */
export type GithubSource = {
  readonly kind: "github";
  /** `owner/name` as entered. */
  readonly repo: string;
  /** Null: the default branch. */
  readonly ref: string | null;
  /** The resolved 40-character commit SHA. */
  readonly sha: string;
};

export type ProjectSource =
  | GithubSource
  | {
      readonly kind: "zip";
      /** The file name. */
      readonly name: string;
      /** Hex SHA-256 of the zip; absent where `crypto.subtle` isn't available (insecure contexts, ADR 0044). */
      readonly sha256?: string;
    };

/** A project record as stored in IndexedDB (schema v1). `source` is optional and additive: no version bump (F-401). Times are milliseconds since the epoch. */
export interface ProjectMeta {
  readonly id: string;
  readonly name: string;
  readonly languageVersion: string;
  readonly createdAt: number;
  /** Changes on every save and rename. */
  readonly updatedAt: number;
  /** Changes on every open; the most recent project is reopened after a reload. */
  readonly openedAt: number;
  readonly source?: ProjectSource;
}

/** A staged import (F-403): the stage's id and the ignore list text to select the files with. */
export interface ImportChoice {
  readonly id: string;
  readonly ignore: string;
}

/** What staging a zip returns: the summary of what would be imported, or why the zip is refused. */
export type ImportStageResult =
  | { readonly ok: true; readonly id: string; readonly summary: ImportSummary }
  | ImportRefusal;

/** A file chosen or dropped into the page, with its name: a cloned `Blob` loses it (F-210). */
export interface NamedBlob {
  readonly blob: Blob;
  readonly name: string;
}

/** What to add from a staged import (F-210): the stage, the zip's ignore list, whether a stripped folder is kept, and the target folder ("" is the project root). */
export interface AddChoice {
  readonly id: string;
  readonly ignore: string;
  readonly keepFolder: boolean;
  readonly folder: string;
}

/** What adding would do. `replaced` and `conflicts` list at most 100 entries; the counts are complete. */
export interface AddPreview {
  readonly ok: true;
  readonly id: string;
  readonly summary: ImportSummary;
  readonly folder: string;
  /** Files that would be written, including the ones that replace others. */
  readonly adds: number;
  readonly replaced: readonly string[];
  readonly replacedCount: number;
  readonly conflicts: readonly AddConflict[];
  readonly conflictCount: number;
}

export type AddPreviewResult = AddPreview | ImportRefusal | EngineRefusal;

export interface NewProject {
  readonly name: string;
  readonly languageVersion: string;
  readonly files: readonly ProjectFile[];
  /** A template id from the pack, or the engine's `BLANK_TEMPLATE` (F-203): the project starts with that template's files, so `files` must be empty. */
  readonly template?: string;
  /** The Publish docs to GitHub Pages choice (UX-60). Carried with the request; it has no effect until F-606. */
  readonly publishDocs?: boolean;
  /** A staged zip import (F-403): the worker copies its selected files, so `files` must be empty and there is no `template`. */
  readonly import?: ImportChoice;
}

/** A downloaded file: raw bytes, decoded in the worker so a BOM and line endings survive (F-401). */
export interface ImportFile {
  readonly path: string;
  readonly bytes: ArrayBuffer;
}

export interface ImportProject {
  readonly name: string;
  readonly languageVersion: string;
  readonly source: GithubSource;
  readonly files: readonly ImportFile[];
}

export interface ImportedProject {
  readonly meta: ProjectMeta;
  /** Files whose bytes aren't text; they weren't stored. */
  readonly skipped: readonly {
    readonly path: string;
    readonly reason: "not-text";
  }[];
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
  /**
   * Counts the statuses the worker has pushed. Pushes and call replies travel on different ports and can overtake each
   * other, so the page ignores a status older than one it has applied.
   */
  readonly seq: number;
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
  seq: 0,
  storage: "starting",
  storageError: null,
  projects: [],
  current: null,
  opening: null,
  openError: null,
  save: { status: "saved", error: null },
};

/** What `openProject` returns: the summary, and the `seq` of the status that made the project current. */
export interface OpenedProject {
  readonly summary: ProjectSummary;
  readonly seq: number;
}

/** What to export (F-404): whether the layout sidecar goes in the zip (UX-62, ADR 0008). */
export interface ExportOptions {
  readonly layout: boolean;
}

/** The zip of the project at one revision (F-404). `files` counts the entries. */
export interface ExportResult {
  readonly ok: true;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly files: number;
  readonly revision: number;
}

export interface WorkspaceApi extends EngineApi {
  /** A zip of every project file at the current revision, ordered after earlier changes (F-404, IO-20). */
  exportProject(options: ExportOptions): Promise<ExportResult | EngineRefusal>;
  watch(listener: (status: WorkspaceStatus) => void): Promise<WorkspaceStatus>;
  /** Reads a zip in the worker and stages it; the page gets the summary only (F-403). `name` is the file's name, which a cloned `Blob` loses. */
  stageZip(file: Blob, name: string): Promise<ImportStageResult>;
  /** The summary of the staged import under another ignore list. */
  restageImport(id: string, ignore: string): Promise<ImportStageResult>;
  discardImport(id: string): Promise<void>;
  /** Reads loose files in the worker and stages them like a zip, without an ignore list (F-210). */
  stageFiles(files: readonly NamedBlob[]): Promise<ImportStageResult>;
  /** What `addFiles` would do with the staged import, without changing the project (F-210). */
  previewAdd(choice: AddChoice): Promise<AddPreviewResult>;
  /** Writes the staged import into a folder of the open project as raw writes: they replace files and clear the undo history (ADR 0051). */
  addFiles(choice: AddChoice): Promise<ProjectChange | EngineRefusal>;
  createProject(input: NewProject): Promise<ProjectMeta>;
  /** Stores a project from downloaded bytes with its source, in one transaction (F-401). Stores nothing when it throws. */
  importProject(input: ImportProject): Promise<ImportedProject>;
  openProject(id: string): Promise<OpenedProject>;
  renameProject(id: string, name: string): Promise<ProjectMeta>;
  deleteProject(id: string): Promise<void>;
  flush(): Promise<SaveState>;
}
