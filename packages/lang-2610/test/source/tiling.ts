import type { ConfigAst, ScriptAst } from "@nf-builder/lang-core";
import { codeSpan } from "../../src/source/prescan.ts";

/**
 * The losslessness invariants of a modelled file (3.2): items sorted and not overlapping, each Unparsed holding its exact
 * slice, comments outside every Unparsed, and nothing but whitespace, `;` and comments between items. Returns the
 * violations; empty means the model accounts for every character.
 */
export function checkTiling(
  text: string,
  ast: ScriptAst | ConfigAst,
): string[] {
  const items = ast.kind === "Script" ? ast.body : ast.statements;
  const grammar = ast.kind === "Script" ? "script" : "config";
  const problems: string[] = [];
  let at = 0;
  for (const item of items) {
    if (item.range.start < at) problems.push(`overlap at ${item.range.start}`);
    const gap = codeSpan(text, at, Math.max(at, item.range.start), grammar);
    if (gap) problems.push(`code between items at ${gap.start}`);
    if (item.kind === "Unparsed") {
      if (item.text !== text.slice(item.range.start, item.range.end))
        problems.push(
          `Unparsed text differs from its slice at ${item.range.start}`,
        );
      for (const c of ast.comments)
        if (c.range.start >= item.range.start && c.range.end <= item.range.end)
          problems.push(`comment inside Unparsed at ${c.range.start}`);
    }
    at = Math.max(at, item.range.end);
  }
  const tail = codeSpan(text, at, text.length, grammar);
  if (tail) problems.push(`code after the last item at ${tail.start}`);
  return problems;
}
