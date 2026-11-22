// Parse problems as Monaco markers (F-208, AR-24). The engine counts columns in code points; Monaco counts UTF-16 units.
import type { ParseProblem } from "@nf-builder/engine";

export interface MarkerSpec {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
  readonly message: string;
}

/** The last line number that exists, at most `line`. */
function clampLine(line: number, lineAt: (n: number) => string | null): number {
  let n = Math.max(1, Math.floor(line));
  while (n > 1 && lineAt(n) === null) n--;
  return n;
}

/** The 1-based UTF-16 column of a 1-based code-point column on `text`, clamped to the end of the line. */
function utf16Column(text: string, column: number): number {
  let units = 0;
  let points = 0;
  for (const point of text) {
    if (points >= column - 1) break;
    units += point.length;
    points++;
  }
  return units + 1;
}

export function problemsToMarkers(
  problems: readonly ParseProblem[],
  lineAt: (line: number) => string | null,
): MarkerSpec[] {
  return problems.map((p) => {
    const startLine = clampLine(p.line, lineAt);
    const endLine = Math.max(startLine, clampLine(p.endLine, lineAt));
    const startColumn = utf16Column(lineAt(startLine) ?? "", p.column);
    let endColumn = utf16Column(lineAt(endLine) ?? "", p.endColumn);
    if (endLine === startLine && endColumn < startColumn)
      endColumn = startColumn;
    return {
      startLineNumber: startLine,
      startColumn,
      endLineNumber: endLine,
      endColumn,
      message: p.message,
    };
  });
}
