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
import { codeSpan, type Grammar, Positioner, scanHead } from "./prescan.ts";

type Point = { readonly line: number; readonly column: number };
const compare = (a: Point, b: Point) => a.line - b.line || a.column - b.column;

let cached: { text: string; positions: Positioner } | null = null;
/** The range of `text[start, end)`; the positioner is kept for the next call (a file is isolated chunk by chunk). */
export function rangeOf(text: string, start: number, end: number): Range {
  if (cached?.text !== text) cached = { text, positions: new Positioner(text) };
  return cached.positions.range(start, end);
}

/**
 * Isolate the items that cannot be modelled. `problems` are the whole-file parse's errors: those with `scope: "file"`
 * never isolate an item. `bounds` is the part of `text` the items come from (a chunk), so gaps are only looked for there. Returns the new item list and the comments that lie outside every `Unparsed`.
 */
export function isolate<I extends AstNode>(
  items: readonly I[],
  problems: readonly ParseProblem[],
  text: string,
  grammar: Grammar,
  comments: readonly Comment[],
  bounds: { readonly start: number; readonly end: number } = {
    start: 0,
    end: text.length,
  },
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
    ...(from?.kind === "InvalidDeclaration"
      ? { invalidDeclaration: true as const }
      : {}),
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

  let at = bounds.start;
  for (const item of items) {
    addGap(at, item.range.start);
    const found = inside(item.range);
    if (item.kind === "InvalidDeclaration" || found.length > 0) {
      out.push(unparsed(item.range, found, item));
      kept.push(item.range);
    } else out.push(item);
    at = Math.max(at, item.range.end);
  }
  addGap(at, bounds.end);

  return {
    items: out,
    comments: comments.filter(
      (c) =>
        !kept.some((r) => c.range.start >= r.start && c.range.end <= r.end),
    ),
  };
}
