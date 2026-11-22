import type { ConfigAst } from "./config.ts";
import type { ScriptAst } from "./script.ts";

/** F-101's `ParseError` is assignable to this. */
export interface ParseProblem {
  readonly source: "lexer" | "parser" | "builder";
  /** nf-lang wording, as `nextflow lint` prints it. */
  readonly message: string;
  /** 1-based, code points, end exclusive (except escape errors, whose columns are UTF-16 units as nf-lang reports them). */
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** What a builder returns for one file: the tree and every error found, or the errors alone when it could not build one. */
export type ParseResult<Ast> =
  | {
      readonly ok: true;
      readonly ast: Ast;
      /** Collected errors, sorted; empty when `nextflow lint`'s parse phase passes. */
      readonly errors: readonly ParseProblem[];
    }
  | {
      /** A lexer, parser or fatal builder error, plus the errors collected before it. */
      readonly ok: false;
      readonly errors: readonly ParseProblem[];
    };

export type ScriptParseResult = ParseResult<ScriptAst>;
export type ConfigParseResult = ParseResult<ConfigAst>;
