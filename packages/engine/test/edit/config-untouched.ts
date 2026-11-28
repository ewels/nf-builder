// What a config edit leaves alone (F-601, AR-22): shared by the property test and the corpus test.
import type {
  ConfigAst,
  ConfigSourceFile,
  TextEdit,
} from "@nf-builder/lang-core";
import { walk } from "@nf-builder/lang-core";
import { expect } from "vitest";
import { spanOf } from "../../src/edit/config/splice";

const overlaps = (r: { start: number; end: number }, e: TextEdit): boolean =>
  e.start === e.end
    ? r.start < e.start && e.start < r.end
    : r.start < e.end && e.start < r.end;

/** AR-22: a statement or comment no edit touches survives at its shifted place with its exact text. */
export function checkUntouched(
  before: ConfigSourceFile,
  after: string,
  edits: readonly TextEdit[],
  label: string,
) {
  const shift = (offset: number) =>
    edits.reduce(
      (at, e) =>
        e.end <= offset ? at + e.text.length - (e.end - e.start) : at,
      offset,
    );
  const ast = before.ast as ConfigAst;
  walk(ast, (node) => {
    if (node.kind === "ConfigFile") return undefined;
    const isStatement =
      node.kind.startsWith("Config") || node.kind === "Unparsed";
    if (!isStatement) return false;
    const span = spanOf(node);
    if (edits.some((e) => overlaps(span, e))) return undefined;
    const start = shift(span.start);
    const text = before.text.slice(span.start, span.end);
    expect(
      after.slice(start, start + text.length),
      `${label}: ${node.kind} at ${node.range.line}`,
    ).toBe(text);
    return false;
  });
  for (const comment of before.comments) {
    if (edits.some((e) => overlaps(comment.range, e))) continue;
    const start = shift(comment.range.start);
    expect(
      after.slice(start, start + comment.text.length),
      `${label}: comment ${JSON.stringify(comment.text)}`,
    ).toBe(comment.text);
  }
}
