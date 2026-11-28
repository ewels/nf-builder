import type { ConfigApply, ConfigAst, ConfigStatement } from "./ast/config.ts";
import type { Comment } from "./ast/range.ts";
import type { Declaration, ScriptAst } from "./ast/script.ts";

/** What the printer needs from the text a tree was parsed from (nf-lang `Comments`). */
export interface SourceLayout {
  /** Lines with no token directly above `line` (1-based; a multi-line string or comment counts as content on every line it spans). 0 when line < 1. */
  blankLinesBefore(line: number): number;
  /** Whether the first token on `line` starts at `column` (1-based, code points). */
  startsLine(line: number, column: number): boolean;
}

export interface PrintOptions {
  /** Layout of the text the tree's positioned nodes were parsed from. Omit it for a synthesised tree. Nodes with `NO_RANGE` always use the fresh layout. */
  readonly layout?: SourceLayout;
}

export interface PrintResult {
  readonly text: string;
  /** Attached comments the printer didn't emit (nf-lang `getMissingComments`). Empty unless the printer has a bug; never write `text` when it isn't. */
  readonly missingComments: readonly Comment[];
}

/** The printer of one language pack (ADR 0005, AR-20). Prints only trees whose parse reported no errors in the printed part, as `nextflow lint -format` formats only error-free files. */
export interface ScriptPrinter {
  createLayout(text: string): SourceLayout;
  /** The whole file: shebang, declarations or a code snippet, and the script's dangling comments. "" for an empty script. */
  printScript(ast: ScriptAst, options?: PrintOptions): PrintResult;
  /** One declaration: its leading comments (no blank lines before the first), the declaration, its trailing comment and a final "\n". */
  printDeclaration(node: Declaration, options?: PrintOptions): PrintResult;
}

/**
 * The config printer of a pack (F-601, ADR 0032): a port of nf-lang's `ConfigFormattingVisitor` with default options. It
 * shares `createLayout` with the script printer.
 */
export interface ConfigPrinter {
  /** The whole file, as `nextflow lint -format` prints it. Throws `PrintError` for an `Unparsed` item or an error-only node. */
  printConfig(ast: ConfigAst, options?: PrintOptions): PrintResult;
  /** One statement: its leading comments, the statement, its trailing comment and a final "\n", at `indent` levels (default 0). */
  printConfigStatement(
    node: ConfigStatement | ConfigApply,
    options?: PrintOptions & { readonly indent?: number },
  ): PrintResult;
}

/** Thrown for the error-only node kinds and for a script that mixes top-level statements and declarations. */
export class PrintError extends Error {
  readonly node: { readonly kind: string };

  constructor(message: string, node: { readonly kind: string }) {
    super(message);
    this.name = "PrintError";
    this.node = node;
  }
}
