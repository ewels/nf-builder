// The engine's API as plain data (F-113, ADR 0003). Pure TypeScript: the Comlink bridge in apps/web wraps it. Every result
// survives structuredClone, so it can cross the worker boundary unchanged.
import type {
  DeclarationForm,
  Diagnostic,
  EditCommand,
  FieldProblem,
  FileText,
  FormChoices,
  PaletteView,
  ParseProblem,
  ParseStatus,
  PortRef,
  Projection,
  QuickFix,
  RefusalCode,
  SourceLanguage,
  TextPatch,
  WorkflowRef,
  WorkflowTarget,
} from "@nf-builder/lang-core";
import type { ClipboardSummary, CopyRequest } from "../clipboard/fragment";
import type { PasteAlias } from "../clipboard/paste";
import type { ConfigSchema, ConfigView } from "../config/types";
import type { NodeDetails, OutlineItem } from "../details/types";
import type { ConnectionTarget } from "../edit/connection-targets";
import type { FreshNameRequest } from "../edit/fresh-name";
import type { ProjectFiles, RegistryFolder } from "../files/types";
import type { HistoryStatus } from "../history/history";
import type {
  LayoutChange,
  LayoutStatus,
  LayoutWrite,
  MoveHint,
  Point,
  Positions,
} from "../layout";
import type { ProjectFile } from "../model/project";
import type { PluginScopes } from "../plugins/config-scopes";
import type { DeclaredPlugin } from "../plugins/declared";
import type { ProjectReport } from "../report/report";
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

export type { ProjectFiles, RegistryFolder } from "../files/types";

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
  /** How the layout sidecar read at open (F-207). */
  readonly layout: LayoutStatus;
}

export interface ProjectChange {
  readonly revision: number;
  readonly files: readonly FileText[];
  /** The files whose model was recomputed, sorted. */
  readonly remodelled: readonly string[];
  readonly workflows: readonly WorkflowRef[];
  /** The undo history after this change (F-209). */
  readonly history: HistoryStatus;
  /** The files or folders this change moved, so open tabs can follow them (F-303); absent when none. */
  readonly moves?: readonly MoveHint[];
}

export type EngineRefusalCode =
  | RefusalCode
  | "stale"
  | "no-project"
  | "no-history"
  /** Returned only by the page's canvas store below 1024 px (F-703, UX-04), never by the worker. */
  | "read-only";

export interface EngineRefusal {
  readonly ok: false;
  /** The project's revision, null without a project. */
  readonly revision: number | null;
  readonly code: EngineRefusalCode;
  readonly message: string;
  readonly path: string | null;
  readonly problems: readonly ParseProblem[];
  /** The form fields a refused `UpdateDeclaration` is about (F-303). */
  readonly fields?: readonly FieldProblem[];
}

export interface Applied extends ProjectChange {
  readonly ok: true;
  readonly patches: readonly TextPatch[];
  /** Applying these restores the exact previous bytes (AR-23). */
  readonly inverse: readonly TextPatch[];
}

/** A default name for a new definition and the file it would be written to (F-301). */
export interface FreshName {
  readonly revision: number;
  readonly name: string;
  readonly path: string;
}

/** The output port being dragged, in the workflow `path`/`workflow` (null for the entry workflow) (F-302). */
export interface ConnectionTargetsRequest {
  readonly path: string;
  readonly workflow: string | null;
  readonly from: PortRef;
}

/** What connecting `from` to each input port of the workflow would do, at `revision` (F-302, UX-25). */
export interface ConnectionTargetsResult {
  readonly revision: number;
  readonly from: PortRef;
  readonly targets: readonly ConnectionTarget[];
}

export type { ClipboardSummary, CopyRequest } from "../clipboard/fragment";
export type { PasteAlias } from "../clipboard/paste";

/** What a copy put on the clipboard (F-310). */
export interface Copied {
  readonly revision: number;
  readonly summary: ClipboardSummary;
}

/** The aliases a paste into `target` needs, at `revision` (F-310, ADR 0039). */
export interface PastePlanned {
  readonly revision: number;
  readonly aliases: readonly PasteAlias[];
}

export interface PasteRequest {
  readonly target: WorkflowTarget;
  /** The aliases `planPaste` offered, confirmed by the user; a paste that needs others is refused. */
  readonly aliases: readonly PasteAlias[];
  /** Where the centre of the pasted nodes lands (canvas coordinates); null leaves them to the auto-layout. */
  readonly at: Point | null;
}

/** A paste: one change, one undo step. */
export interface Pasted extends ProjectChange {
  readonly ok: true;
  /** The ids of the new nodes, in the order the nodes were copied. */
  readonly pasted: readonly string[];
}

export type ApplyOutcome = Applied | EngineRefusal;

/** How `apply` records a command in the undo history (F-209). */
export interface ApplyOptions {
  /** Commands applied in a row with the same group token make one undo step (F-301, F-310). */
  readonly group?: string;
  /** The step's label; the first command of a group sets it. Defaults to the command's own label. */
  readonly label?: string;
}

/** How `undo` treats the step it takes back. */
export interface UndoOptions {
  /** Leave no redo step: for a rollback of a step that should never come back (F-301). */
  readonly discard?: boolean;
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
  /** The stored positions of this projection's nodes; empty when the sidecar is unreadable (F-207). */
  readonly positions: Positions;
}

export interface DiagnosticsResult {
  readonly revision: number;
  readonly diagnostics: readonly Diagnostic[];
  /** The registry module folders, so the Suggestions tab can list their files last (F-405). */
  readonly registry: readonly RegistryFolder[];
  /** The plugin scopes the lints used (`EngineApi.setPluginScopes`); the page pulls again when it changes (F-505). */
  readonly pluginsKey: string;
}

/** The Configure form of a node's declaration, read at `revision` (F-303, UX-41). */
export interface DeclarationFormResult {
  readonly revision: number;
  /** The declaration the form edits: its file and name. */
  readonly target: { readonly path: string; readonly name: string };
  readonly form: DeclarationForm;
  readonly choices: FormChoices;
  /** The declaration's text as the Code tab shows it, doc comment included, and where it sits in its file (F-304, UX-43). */
  readonly text: string;
  readonly span: { readonly start: number; readonly end: number };
}

/** A declaration's text as the Code tab holds it (F-304, UX-43). */
export interface DeclarationCode {
  readonly path: string;
  /** The declaration as it is named in the project now. */
  readonly name: string;
  readonly text: string;
}

/** The Configure form of a Code tab text (F-304, UX-44). */
export interface DeclarationCodeResult {
  readonly revision: number;
  /** The name the text gives the declaration. */
  readonly name: string;
  readonly form: DeclarationForm;
  readonly choices: FormChoices;
}

export interface NodeDetailsResult {
  readonly revision: number;
  /** Null when the projection has no such node. */
  readonly details: NodeDetails | null;
}

/** The config editor's view of one config file at a revision (F-601, AR-30). */
export interface ConfigViewResult {
  readonly revision: number;
  /** Null when the file's text can't be viewed at all. */
  readonly view: ConfigView | null;
  /** The plugin scopes the view's rules used; the page pulls again when it changes (F-505). */
  readonly pluginsKey: string;
}

/** The plugins the root `nextflow.config` declares at a revision (F-505, IO-33). */
export interface PluginsResult {
  readonly revision: number;
  readonly plugins: readonly DeclaredPlugin[];
}

export interface OutlineResult {
  readonly revision: number;
  /** The declarations of a Nextflow file; empty for any other file (F-605, FI-31). */
  readonly items: readonly OutlineItem[];
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
  undo(revision: number, options?: UndoOptions): Promise<HistoryOutcome>;
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
  /** Parse failures, legacy share and diagnostic counts of the current revision (F-401, UX-61). */
  report(): Promise<ProjectReport | EngineRefusal>;
  /** The declaration details and diagnostics of one node of a workflow's projection (F-206). */
  details(
    path: string,
    workflow: string | null,
    node: string,
  ): Promise<NodeDetailsResult | EngineRefusal>;
  /** The Configure form and choices for a call node of a typed process (F-303); `invalid` with the reason for any other node, `not-found` for an unknown one. */
  declarationForm(
    path: string,
    workflow: string | null,
    node: string,
  ): Promise<DeclarationFormResult | EngineRefusal>;
  /** The form of the text a Code tab holds; `does-not-parse` with problems on the text's own lines when it isn't one typed process of the declaration's kind (F-304, UX-44). Read-only. */
  parseDeclaration(
    request: DeclarationCode,
  ): Promise<DeclarationCodeResult | EngineRefusal>;
  /** The text printed as `nextflow lint -format` lays it out, without a final newline (F-304, UX-43); refused as `parseDeclaration` is. Read-only. */
  formatDeclaration(
    request: DeclarationCode,
  ): Promise<
    { readonly revision: number; readonly text: string } | EngineRefusal
  >;
  /** The Code tab's text for a form: `UpdateDeclaration` applied to the declaration alone (to `base` text, or to the project's own when null) and its text read back; nothing changes (F-304, UX-44). */
  declarationText(request: {
    readonly path: string;
    readonly name: string;
    readonly base: string | null;
    readonly form: DeclarationForm;
  }): Promise<
    { readonly revision: number; readonly text: string } | EngineRefusal
  >;
  /** The config editor's view of a config file: cards, rows, selector counts and the diagnostics in them (F-601). `not-found` for a path that isn't a config file. */
  configView(path: string): Promise<ConfigViewResult | EngineRefusal>;
  /** The config catalogue as a clone-safe tree, for descriptions and Add scope (F-601). Needs no open project; rejects for an unknown version. */
  configSchema(version: string): Promise<ConfigSchema>;
  /** The plugins declared in the root `nextflow.config`, in source order (F-505, IO-33; amends ADR 0043's API list). */
  plugins(): Promise<PluginsResult | EngineRefusal>;
  /** Gives the worker the config scopes of the declared plugins' specs, which the page read; replaces the last set. Cleared when a project opens or closes (F-505, FI-01). */
  setPluginScopes(
    scopes: readonly PluginScopes[],
  ): Promise<{ readonly pluginsKey: string }>;
  /** The declarations of one file, for the details pane of a file tab (F-605, FI-31, amends ADR 0043's API list). */
  outline(path: string): Promise<OutlineResult | EngineRefusal>;
  /**
   * The only writer of `.nf-builder/layout.json` (F-207). Merges or replaces one workflow's positions and returns the
   * sidecar's new text in `files` (empty when nothing changed or the file is newer than this build). It doesn't advance
   * the revision.
   */
  setLayout(write: LayoutWrite): Promise<LayoutChange | EngineRefusal>;
  /** Every file with its parse status, and the registry module folders, for the Files view (UX-16, F-210). */
  listFiles(): Promise<ProjectFiles | EngineRefusal>;
  /**
   * For a dragged output port, the status of every input port of the workflow: `ok`, `mismatch` (allowed, an error once
   * connected, LA-29) or `refused` (UX-25, F-302; amends ADR 0043's API list).
   */
  connectionTargets(
    request: ConnectionTargetsRequest,
  ): Promise<ConnectionTargetsResult | EngineRefusal>;
  /** A name for a new process or workflow added from the palette, free in `caller`'s scope and directory (F-301). */
  freshName(request: FreshNameRequest): Promise<FreshName | EngineRefusal>;
  /**
   * Puts the call nodes (processes and workflows) of a workflow, with their definitions and the connections between
   * them, on the engine's clipboard, replacing it (F-310, UX-26; amends ADR 0043's API list). The clipboard lives in the
   * worker, so it survives `close` and the next `open`; it holds file text the page never sees (AR-30).
   */
  copy(request: CopyRequest): Promise<Copied | EngineRefusal>;
  /** What the clipboard holds, or null; needs no open project. */
  clipboard(): Promise<ClipboardSummary | null>;
  /** The names a paste into `target` would give the callees that are already called or taken there (F-310, F-111). */
  planPaste(request: {
    target: WorkflowTarget;
  }): Promise<PastePlanned | EngineRefusal>;
  /**
   * Pastes the clipboard into `target` as one undo step labelled "Paste N nodes": files, includes, calls and
   * connections, then the positions. A refused part rolls the whole paste back (F-310, ADR 0060).
   */
  paste(
    request: PasteRequest,
    revision: number,
  ): Promise<Pasted | EngineRefusal>;
  /** The current text of a file, or null with no project or no such file. */
  readFile(path: string): Promise<string | null>;
  /** Drops the open project; later calls answer `no-project` until the next `open`. The revision counter keeps counting. */
  close(): Promise<void>;
}
