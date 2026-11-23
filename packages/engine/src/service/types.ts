// The engine's API as plain data (F-113, ADR 0003). Pure TypeScript: the Comlink bridge in apps/web wraps it. Every result
// survives structuredClone, so it can cross the worker boundary unchanged.
import type {
  Diagnostic,
  EditCommand,
  FileText,
  PaletteView,
  ParseProblem,
  ParseStatus,
  Projection,
  QuickFix,
  RefusalCode,
  SourceLanguage,
  TextPatch,
  WorkflowRef,
} from "@nf-builder/lang-core";
import type { NodeDetails } from "../details/types";
import type { HistoryStatus } from "../history/history";
import type { ProjectFile } from "../model/project";
import type { TemplateList } from "../templates";

export interface OpenRequest {
  readonly version: string;
  readonly files: readonly ProjectFile[];
}

export type LoadPhase = "loading" | "parsing" | "modelling";

/** Advisory loading progress. `done` counts files started (parsing begins on each), not finished; `path` is null outside the parsing phase. */
export interface LoadProgress {
  readonly phase: LoadPhase;
  readonly done: number;
  readonly total: number;
  readonly path: string | null;
}

export interface FileSummary {
  readonly path: string;
  readonly language: SourceLanguage;
  readonly status: ParseStatus;
  readonly problems: number;
}

export interface ProjectSummary {
  readonly revision: number;
  readonly version: string;
  readonly files: readonly FileSummary[];
  readonly workflows: readonly WorkflowRef[];
}

export interface ProjectChange {
  readonly revision: number;
  readonly files: readonly FileText[];
  /** The files whose model was recomputed, sorted. */
  readonly remodelled: readonly string[];
  readonly workflows: readonly WorkflowRef[];
  /** The undo history after this change (F-209). */
  readonly history: HistoryStatus;
}

export type EngineRefusalCode =
  | RefusalCode
  | "stale"
  | "no-project"
  | "no-history";

export interface EngineRefusal {
  readonly ok: false;
  /** The project's revision, null without a project. */
  readonly revision: number | null;
  readonly code: EngineRefusalCode;
  readonly message: string;
  readonly path: string | null;
  readonly problems: readonly ParseProblem[];
}

export interface Applied extends ProjectChange {
  readonly ok: true;
  readonly patches: readonly TextPatch[];
  /** Applying these restores the exact previous bytes (AR-23). */
  readonly inverse: readonly TextPatch[];
}

export type ApplyOutcome = Applied | EngineRefusal;

/** How `apply` records a command in the undo history (F-209). */
export interface ApplyOptions {
  /** Commands applied in a row with the same group token make one undo step (F-301, F-310). */
  readonly group?: string;
  /** The step's label; the first command of a group sets it. Defaults to the command's own label. */
  readonly label?: string;
}

/** A successful undo or redo: the change it made and the label of the step it moved. */
export interface Undone extends ProjectChange {
  readonly ok: true;
  readonly label: string;
}

export type HistoryOutcome = Undone | EngineRefusal;

export interface ProjectionResult {
  readonly revision: number;
  readonly projection: Projection | null;
}

export interface DiagnosticsResult {
  readonly revision: number;
  readonly diagnostics: readonly Diagnostic[];
}

export interface NodeDetailsResult {
  readonly revision: number;
  /** Null when the projection has no such node. */
  readonly details: NodeDetails | null;
}

export interface EngineApi {
  palette(version: string): Promise<PaletteView>;
  /** The pack's project templates for a version, without file text (F-203). Needs no open project. */
  templates(version: string): Promise<TemplateList>;
  open(
    request: OpenRequest,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<ProjectSummary>;
  /** Raw writes (imports, uploads, deletes) with no AR-24 guard (ADR 0004). */
  writeFiles(
    files: readonly FileText[],
  ): Promise<ProjectChange | EngineRefusal>;
  apply(
    command: EditCommand,
    revision: number,
    options?: ApplyOptions,
  ): Promise<ApplyOutcome>;
  /**
   * Applies a quick fix as one `ReplaceFileText` and one undo step labelled `options.label ?? fix.title` (F-309, ADR 0042).
   * `revision` is the revision the fix was diagnosed at: the fix is refused as stale when its own file changed after that.
   */
  applyFix(
    fix: QuickFix,
    revision: number,
    options?: ApplyOptions,
  ): Promise<ApplyOutcome>;
  /** Undoes the newest step; `revision` must be current. Advances the revision by one (F-209, AR-23). */
  undo(revision: number): Promise<HistoryOutcome>;
  /** Re-applies the newest undone step; `revision` must be current. */
  redo(revision: number): Promise<HistoryOutcome>;
  /** The undo history of the open project; empty with no project. */
  history(): Promise<HistoryStatus>;
  /** Raw patches built on `revision`. They clear the undo history. */
  applyPatches(
    patches: readonly TextPatch[],
    revision: number,
  ): Promise<ApplyOutcome>;
  project(
    path: string,
    workflow: string | null,
  ): Promise<ProjectionResult | EngineRefusal>;
  diagnostics(): Promise<DiagnosticsResult | EngineRefusal>;
  /** The declaration details and diagnostics of one node of a workflow's projection (F-206). */
  details(
    path: string,
    workflow: string | null,
    node: string,
  ): Promise<NodeDetailsResult | EngineRefusal>;
  /** The current text of a file, or null with no project or no such file. */
  readFile(path: string): Promise<string | null>;
  /** Drops the open project; later calls answer `no-project` until the next `open`. The revision counter keeps counting. */
  close(): Promise<void>;
}
