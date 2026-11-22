/** A line and column as `nextflow lint` prints them: 1-based, the column counted in code points. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** Half-open source range. `text.slice(start, end)` is the node's exact source text. */
export interface Range {
  /** UTF-16 offset of the first character. */
  readonly start: number;
  /** UTF-16 offset just past the last character. */
  readonly end: number;
  /** 1-based; lines end at "\n" only (as ANTLR counts them). */
  readonly line: number;
  /** 1-based, in code points (nf-lang and `nextflow lint` columns). */
  readonly column: number;
  readonly endLine: number;
  /** 1-based column just past the last character, in code points. */
  readonly endColumn: number;
}

/** `doc` starts with `/**` (nf-lang's GroovydocManager). */
export type CommentKind = "line" | "block" | "doc" | "shebang";

export interface Comment {
  readonly kind: CommentKind;
  /** Exact source text with delimiters; equals the slice of `range`. */
  readonly text: string;
  readonly range: Range;
  /** First token on its line (nf-lang `Comment.ownLine`). */
  readonly ownLine: boolean;
}

export interface CommentSlots {
  readonly leadingComments?: readonly Comment[];
  readonly trailingComments?: readonly Comment[];
  readonly danglingComments?: readonly Comment[];
}

/** What every AST node, script or config, has. */
export interface NodeBase<K extends string> extends CommentSlots {
  readonly kind: K;
  readonly range: Range;
}

/** The range of a node an edit created, until the file is re-parsed. It slices nothing; the printer gives such nodes no blank lines and no source-driven wrapping (nf-lang: line -1). */
export const NO_RANGE: Range = {
  start: -1,
  end: -1,
  line: -1,
  column: -1,
  endLine: -1,
  endColumn: -1,
};

/** nf-lang `Comment.hasPosition`: line > 0. */
export function hasPosition(range: Range): boolean {
  return range.line > 0;
}
