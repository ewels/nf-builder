// Whitespace-only perturbations (F-106 step 2): extra indentation, blank lines, trailing blanks and CRLF line ends, only
// at line starts and ends that lie outside strings, comments and unparsed text, and never after a `\` continuation.

import { type AstNode, type Range, walk } from "@nf-builder/lang-core";

export type PerturbKind = "indent" | "blank" | "trailing" | "crlf" | "all";

/** A small seeded generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function protectedRanges(
  ast: AstNode & {
    comments?: readonly { range: Range }[];
    shebang?: { range: Range } | null;
  },
): Range[] {
  const ranges: Range[] = [];
  walk(ast, (node) => {
    if (
      node.kind === "String" ||
      node.kind === "GString" ||
      node.kind === "Unparsed"
    )
      ranges.push(node.range);
  });
  for (const c of ast.comments ?? []) ranges.push(c.range);
  if (ast.shebang) ranges.push(ast.shebang.range);
  return ranges;
}

/** Returns `text` with whitespace changes only; the AST must be the parse of `text`. */
export function perturbWhitespace(
  text: string,
  ast: AstNode | null,
  seed: number,
  kind: PerturbKind,
): string {
  if (ast === null) return text;
  const next = random(seed);
  const ranges = protectedRanges(ast);
  // strictly inside: a position at a range's end is still outside it
  const inside = (p: number) => ranges.some((r) => r.start < p && p < r.end);
  // a comment owns the rest of its line, so nothing may be appended after it
  const onComment = (p: number) =>
    ranges.some((r) => r.start <= p && p <= r.end);
  const want = (k: Exclude<PerturbKind, "all">) => kind === "all" || kind === k;
  const crlf = want("crlf");
  const inserts: { at: number; text: string }[] = [];
  for (let p = 0; p < text.length; p++) {
    if (text[p] === "\n") {
      const continued = text[p - 1] === "\\";
      if (!continued && !inside(p)) {
        if (want("trailing") && !onComment(p) && next() < 0.5)
          inserts.push({ at: p, text: next() < 0.5 ? " " : "\t  " });
        if (crlf && text[p - 1] !== "\r") inserts.push({ at: p, text: "\r" });
      }
      const start = p + 1;
      if (continued || start >= text.length || inside(start)) continue;
      if (want("blank") && next() < 0.3)
        inserts.push({ at: start, text: crlf ? "\r\n" : "\n" });
      if (want("indent") && next() < 0.6)
        inserts.push({ at: start, text: next() < 0.5 ? "    " : "\t  " });
    }
  }
  let out = text;
  for (const insert of inserts.reverse())
    out = out.slice(0, insert.at) + insert.text + out.slice(insert.at);
  return out;
}
