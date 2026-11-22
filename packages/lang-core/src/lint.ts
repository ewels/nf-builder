// The lint types a language pack provides (F-112, ADR 0006). Plain data and pure functions: the engine builds the context and runs the rules.

import type { ConfigAst } from "./ast/config.ts";
import type { Range } from "./ast/range.ts";
import type { Include, IncludeEntry } from "./ast/script.ts";
import type { Catalogue } from "./catalogue.ts";
import type { DiagnosticSeverity, TextEdit } from "./diagnostic.ts";
import type { IncludableDeclaration, IncludeTarget } from "./includes.ts";
import type { FlowType, GraphNode, Port, Projection } from "./projection.ts";
import type { ConfigSourceFile, ScriptSourceFile } from "./source-file.ts";

/** Where a code comes from: the parser, the semantic model, `nextflow lint`, nf-lang checks lint hides, our own, or the engine. */
export type DiagnosticOrigin =
  | "parser"
  | "model"
  | "lint"
  | "paranoid"
  | "ours"
  | "internal";

/** What a diagnostic code is: its severity, the spec IDs it serves and where it is ported from. */
export interface DiagnosticCode {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly spec: readonly string[];
  readonly origin: DiagnosticOrigin;
  /** Upstream sources with line numbers (nf-lang v26.10.7) for ported codes; empty for our own. */
  readonly upstream: readonly string[];
  /** Matches the `nextflow lint` message this code corresponds to; set for every lint origin, null otherwise. */
  readonly lintPattern: RegExp | null;
  /** Message patterns that already tell the user what to do without a ` -- <advice>` clause. */
  readonly verbatim: readonly RegExp[];
  /** Whether the code can carry a quick fix. */
  readonly fixable: boolean;
}

export interface LintFix {
  readonly title: string;
  readonly edits: readonly TextEdit[];
}

/** What a rule returns; the engine adds the path, severity and code. */
export interface LintFinding {
  readonly range: Range;
  readonly message: string;
  readonly fix?: LintFix;
}

export interface LintBinding {
  readonly declaration: IncludableDeclaration | null;
  readonly path: string | null;
  readonly typesEnabled: boolean | null;
  readonly entry: IncludeEntry | null;
}

export interface LintInclude {
  readonly include: Include;
  readonly entry: IncludeEntry;
  readonly target: IncludeTarget;
  readonly binding: LintBinding;
  /** Whether the entry names a pipeline (the entry workflow or the params block). */
  readonly pipeline: boolean;
}

export interface LintContext {
  readonly file: ScriptSourceFile | ConfigSourceFile;
  readonly catalogue: Catalogue;
  lookup(name: string): LintBinding | undefined;
  readonly includes: readonly LintInclude[];
  /** The file's modelled workflows, computed on first use. */
  projections(): readonly Projection[];
  /** Every config AST in the project, computed on first use. */
  configs(): readonly ConfigAst[];
}

export interface LintRule {
  readonly code: string;
  check(context: LintContext): readonly LintFinding[];
}

export type Compatibility = "compatible" | "incompatible" | "unknown";

/** The pack's lints, loaded on demand (`LanguagePack.loadLints`). */
export interface PackLints {
  readonly codes: readonly DiagnosticCode[];
  readonly rules: readonly LintRule[];
  /** The message with advice appended, unless it already has a ` -- ` clause. */
  advise(code: string, message: string): string;
  connection(
    source: FlowType | null,
    node: GraphNode,
    port: Port,
    isRecord?: (name: string) => boolean,
  ): Compatibility;
}
