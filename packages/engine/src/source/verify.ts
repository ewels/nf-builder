import type { Comment, SourceFile } from "@nf-builder/lang-core";
import { topLevelItems } from "./items";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const SLOTS = ["leadingComments", "trailingComments", "danglingComments"];

/** How many times each comment object appears in a node's comment slots, found without recursion. */
function slotCounts(root: unknown): Map<Comment, number> {
  const counts = new Map<Comment, number>();
  const stack: unknown[] = [root];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const value = stack.pop();
    if (!isObject(value) || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const v of value) stack.push(v);
      continue;
    }
    for (const [key, v] of Object.entries(value)) {
      if (key === "comments" || key === "shebang") continue;
      if (SLOTS.includes(key) && Array.isArray(v)) {
        for (const c of v as Comment[]) counts.set(c, (counts.get(c) ?? 0) + 1);
      } else stack.push(v);
    }
  }
  return counts;
}

/**
 * Checks the invariants of a file's model (plan 3.2); an empty list means they hold:
 * top-level items sorted, in bounds and not overlapping; each `Unparsed` holding its exact slice; every comment of the
 * map outside every `Unparsed` and in exactly one slot; and nothing between items but whitespace, `;` and comments.
 */
export function verifyModel(file: SourceFile): string[] {
  const problems: string[] = [];
  const { ast, text } = file;
  if (file.status === "plain" || file.status === "verbatim") {
    if (ast !== null) problems.push(`a ${file.status} file has an AST`);
    return problems;
  }
  if (ast === null) return [`a ${file.status} file has no AST`];

  const items = topLevelItems(file);
  const unparsed = items.filter((i) => i.kind === "Unparsed");
  if (file.status === "modelled" && unparsed.length > 0)
    problems.push("a modelled file has Unparsed items");
  if (file.status === "partial" && unparsed.length === 0)
    problems.push("a partial file has no Unparsed item");

  let at = 0;
  const covered: { start: number; end: number }[] = [];
  for (const item of items) {
    const { start, end } = item.range;
    if (start < at || end < start || end > text.length) {
      problems.push(`item at ${start}-${end} is out of order or out of bounds`);
      return problems;
    }
    if (item.kind === "Unparsed" && item.text !== text.slice(start, end))
      problems.push(`Unparsed at ${start} does not hold its slice`);
    covered.push({ start: at, end: start });
    at = end;
  }
  covered.push({ start: at, end: text.length });

  const unparsedRanges = unparsed.map((i) => i.range);
  const counts = slotCounts(ast);
  for (const c of ast.comments) {
    if (text.slice(c.range.start, c.range.end) !== c.text)
      problems.push(`comment at ${c.range.start} does not hold its slice`);
    if (
      unparsedRanges.some(
        (r) => c.range.start >= r.start && c.range.end <= r.end,
      )
    )
      problems.push(`comment at ${c.range.start} is inside an Unparsed`);
    const n = counts.get(c) ?? 0;
    if (n !== 1)
      problems.push(`comment at ${c.range.start} is in ${n} slots, not 1`);
  }

  // between items: only whitespace, `;`, stray closing brackets (the lexer drops them) and comments
  const shebang = ast.kind === "Script" ? ast.shebang : null;
  const comments = [...ast.comments, ...(shebang ? [shebang] : [])].sort(
    (a, b) => a.range.start - b.range.start,
  );
  let next = 0;
  for (const gap of covered) {
    let rest = "";
    let pos = gap.start;
    while (
      next < comments.length &&
      (comments[next] as Comment).range.end <= gap.start
    )
      next++;
    for (let k = next; k < comments.length; k++) {
      const c = (comments[k] as Comment).range;
      if (c.start >= gap.end) break;
      if (c.start >= pos) {
        rest += text.slice(pos, c.start);
        pos = Math.max(pos, c.end);
      }
    }
    rest += text.slice(pos, gap.end);
    if (!/^[\s;)\]}]*$/.test(rest))
      problems.push(`code outside the items at ${gap.start}-${gap.end}`);
  }
  return problems;
}
