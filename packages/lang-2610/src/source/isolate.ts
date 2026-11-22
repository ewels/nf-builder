// Isolation (F-104, ADR 0004): after a whole-file parse that built a tree, an item the builder reported an error for, or
// that it turned into an InvalidDeclaration, is replaced by an `Unparsed` node with its exact text. Code that belongs to
// no item (the builder dropped it, as it does a legacy parameter when types are enabled) becomes an `Unparsed` too. So
// the model never holds a declaration the builder changed, and every character is in an item, a comment or whitespace.
import type {
  AstNode,
  Comment,
  ParseProblem,
  Range,
  Unparsed,
} from "@nf-builder/lang-core";
import { PositionIndex } from "../ast/positions.ts";
import { codeSpan, type Grammar, scanHead } from "./prescan.ts";

type Point = { readonly line: number; readonly column: number };
const compare = (a: Point, b: Point) => a.line - b.line || a.column - b.column;

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** The number of code points before UTF-16 `offset` (how PositionIndex counts). */
function codePointsBefore(text: string, offset: number): number {
  let count = 0;
  for (let i = 0; i < offset; i++) {
    const c = text.charCodeAt(i);
    if (
      !(isLowSurrogate(c) && i > 0 && isHighSurrogate(text.charCodeAt(i - 1)))
    )
      count++;
  }
  return count;
}

/** The range of `text[start, end)`. */
function rangeOf(text: string, start: number, end: number): Range {
  return new PositionIndex(text).range(
    codePointsBefore(text, start),
    codePointsBefore(text, end),
  );
}

/**
 * Isolate the items that cannot be modelled. `problems` are the whole-file parse's errors: those with `scope: "file"`
 * never isolate an item. Returns the new item list and the comments that lie outside every `Unparsed`.
 */
export function isolate<I extends AstNode>(
  items: readonly I[],
  problems: readonly ParseProblem[],
  text: string,
  grammar: Grammar,
  comments: readonly Comment[],
): { items: (I | Unparsed)[]; comments: Comment[] } {
  const local = problems.filter((p) => p.scope !== "file");
  const inside = (r: Range) =>
    local.filter(
      (p) =>
        compare(p, r) >= 0 &&
        compare(p, { line: r.endLine, column: r.endColumn }) < 0,
    );
  const unparsed = (
    range: Range,
    found: ParseProblem[],
    from?: I,
  ): Unparsed => ({
    kind: "Unparsed",
    range,
    text: text.slice(range.start, range.end),
    head: scanHead(text, range.start, grammar),
    problems: found,
    ...(from?.leadingComments ? { leadingComments: from.leadingComments } : {}),
    ...(from?.trailingComments
      ? { trailingComments: from.trailingComments }
      : {}),
  });

  const out: (I | Unparsed)[] = [];
  const kept: Range[] = [];
  const addGap = (from: number, to: number) => {
    if (to <= from) return;
    const span = codeSpan(text, from, to, grammar);
    if (!span) return;
    const range = rangeOf(text, span.start, span.end);
    out.push(unparsed(range, inside(range)));
    kept.push(range);
  };

  let at = 0;
  for (const item of items) {
    addGap(at, item.range.start);
    const found = inside(item.range);
    if (item.kind === "InvalidDeclaration" || found.length > 0) {
      out.push(unparsed(item.range, found, item));
      kept.push(item.range);
    } else out.push(item);
    at = Math.max(at, item.range.end);
  }
  addGap(at, text.length);

  return {
    items: out,
    comments: comments.filter(
      (c) =>
        !kept.some((r) => c.range.start >= r.start && c.range.end <= r.end),
    ),
  };
}
