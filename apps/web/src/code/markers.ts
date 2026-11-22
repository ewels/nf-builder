// Parse problems as Monaco markers (F-208, AR-24). The engine counts columns in code points; Monaco counts UTF-16 units.
import type { ParseProblem } from "@nf-builder/engine";

interface MarkerSpec {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
  readonly message: string;
}

/** The last line number that exists, at most `line`. */
const clampLine = (line: number, lines: readonly string[]): number =>
  Math.max(1, Math.min(Math.floor(line), lines.length));

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
  lines: readonly string[],
): MarkerSpec[] {
  return problems.map((p) => {
    const startLine = clampLine(p.line, lines);
    const endLine = Math.max(startLine, clampLine(p.endLine, lines));
    const startColumn = utf16Column(lines[startLine - 1] ?? "", p.column);
    let endColumn = utf16Column(lines[endLine - 1] ?? "", p.endColumn);
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
