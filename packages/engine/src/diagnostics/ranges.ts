import type { ParseProblem, Range } from "@nf-builder/lang-core";

/** The UTF-16 offset of a 1-based position; `units` counts the column in UTF-16 units instead of code points. Clamped to the line. */
function offsetAt(
  text: string,
  line: number,
  column: number,
  units: boolean,
): number {
  let start = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return text.length;
    start = next + 1;
  }
  const next = text.indexOf("\n", start);
  const lineEnd = next < 0 ? text.length : next;
  let offset = start;
  for (let c = 1; c < column && offset < lineEnd; c++) {
    const code = text.codePointAt(offset) ?? 0;
    offset += units || code < 0x10000 ? 1 : 2;
  }
  return offset;
}

/** The 1-based line and code-point column of an offset; lines end at "\n" only. */
function positionAt(text: string, offset: number) {
  let line = 1;
  let lineStart = 0;
  for (
    let i = text.indexOf("\n");
    i >= 0 && i < offset;
    i = text.indexOf("\n", i + 1)
  ) {
    line++;
    lineStart = i + 1;
  }
  let column = 1;
  for (let o = lineStart; o < offset; ) {
    o += (text.codePointAt(o) ?? 0) < 0x10000 ? 1 : 2;
    column++;
  }
  return { line, column };
}

/**
 * Turns a parse problem's 1-based line and column into a `Range` of the diagnosed text. nf-lang counts code points,
 * except for escape-sequence errors, whose columns are UTF-16 units; the range reports code points either way.
 */
export function problemRange(text: string, problem: ParseProblem): Range {
  const units = problem.message.startsWith("Invalid escape sequence");
  const start = offsetAt(text, problem.line, problem.column, units);
  const end = Math.max(
    start,
    offsetAt(text, problem.endLine, problem.endColumn, units),
  );
  const from = positionAt(text, start);
  const to = positionAt(text, end);
  return {
    start,
    end,
    line: from.line,
    column: from.column,
    endLine: to.line,
    endColumn: to.column,
  };
}
