// The per-file model (AR-01, F-104): path, text, language, parse status, AST and comment map. In memory only (ADR 0027).
import type { ConfigAst } from "./ast/config.ts";
import type { ParseProblem } from "./ast/parse-result.ts";
import type { Comment } from "./ast/range.ts";
import type { ScriptAst } from "./ast/script.ts";
import type { ConfigPrinter, ScriptPrinter } from "./printer.ts";

export type SourceLanguage =
  | "nextflow"
  | "config"
  | "json"
  | "yaml"
  | "markdown"
  | "text";

/**
 * modelled: every top-level item is in the AST. partial: some are `Unparsed`. verbatim: nothing could be modelled and
 * the text is kept as is (ADR 0004). plain: not a Nextflow file, so not parsed.
 */
export type ParseStatus = "modelled" | "partial" | "verbatim" | "plain";

export type SourceParse<Ast> =
  | {
      readonly status: "modelled" | "partial";
      readonly ast: Ast;
      readonly problems: readonly ParseProblem[];
    }
  | {
      readonly status: "verbatim";
      readonly ast: null;
      readonly problems: readonly ParseProblem[];
    };
export type ScriptSourceParse = SourceParse<ScriptAst>;
export type ConfigSourceParse = SourceParse<ConfigAst>;

/**
 * A pack's parser with declaration-level fallback (ADR 0004), and its printer. Parsing never throws, whatever the input
 * (IO-14). Both come from one lazy chunk, so one `pack.loadParser()` carries them.
 */
export interface SourceParser {
  readonly printer: ScriptPrinter;
  readonly configPrinter: ConfigPrinter;
  parseScript(text: string): ScriptSourceParse;
  parseConfig(text: string): ConfigSourceParse;
}

interface SourceFileBase {
  /** Project-relative POSIX path. */
  readonly path: string;
  /** Exact text, authoritative (ADR 0004). */
  readonly text: string;
  /** The whole-file parse's errors (lint parity); empty for plain files. */
  readonly problems: readonly ParseProblem[];
  /** The comment map: `ast.comments`, empty when `ast` is null. */
  readonly comments: readonly Comment[];
}
export interface ScriptSourceFile extends SourceFileBase {
  readonly language: "nextflow";
  readonly status: Exclude<ParseStatus, "plain">;
  readonly ast: ScriptAst | null;
}
export interface ConfigSourceFile extends SourceFileBase {
  readonly language: "config";
  readonly status: Exclude<ParseStatus, "plain">;
  readonly ast: ConfigAst | null;
}
export interface PlainSourceFile extends SourceFileBase {
  readonly language: "json" | "yaml" | "markdown" | "text";
  readonly status: "plain";
  readonly ast: null;
}
export type SourceFile = ScriptSourceFile | ConfigSourceFile | PlainSourceFile;
