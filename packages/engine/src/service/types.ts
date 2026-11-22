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
  RefusalCode,
  SourceLanguage,
  TextPatch,
  WorkflowRef,
} from "@nf-builder/lang-core";
import type { NodeDetails } from "../details/types";
import type { ProjectFile } from "../model/project";

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
}

export type EngineRefusalCode = RefusalCode | "stale" | "no-project";

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
  open(
    request: OpenRequest,
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<ProjectSummary>;
  /** Raw writes (imports, uploads, deletes) with no AR-24 guard (ADR 0004). */
  writeFiles(
    files: readonly FileText[],
  ): Promise<ProjectChange | EngineRefusal>;
  apply(command: EditCommand, revision: number): Promise<ApplyOutcome>;
  /** Undo and redo: applies patches built on `revision`. */
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
