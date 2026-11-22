import type { ParseProblem } from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { problemsToMarkers } from "../src/code/markers";

const problem = (
  line: number,
  column: number,
  endLine: number,
  endColumn: number,
  message = "bad",
): ParseProblem => ({
  source: "parser",
  message,
  line,
  column,
  endLine,
  endColumn,
});

const lines = ["one", "a😀b = )", "three"];
const lineAt = (n: number) => lines[n - 1] ?? null;

describe("F-208 markers", () => {
  it("F-208 AR-24: parse problems become markers on the same lines, with code-point columns converted to UTF-16", () => {
    // code points: a=1 😀=2 b=3 ' '=4 '='=5 ' '=6 ')'=7, so ')' is UTF-16 column 8
    expect(
      problemsToMarkers([problem(2, 7, 2, 8, "unexpected")], lineAt),
    ).toEqual([
      {
        startLineNumber: 2,
        startColumn: 8,
        endLineNumber: 2,
        endColumn: 9,
        message: "unexpected",
      },
    ]);
    expect(problemsToMarkers([problem(1, 1, 3, 3)], lineAt)[0]).toMatchObject({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 3,
    });
  });

  it("F-208: positions beyond the text are clamped", () => {
    const [m] = problemsToMarkers([problem(9, 40, 12, 90)], lineAt);
    expect(m).toMatchObject({ startLineNumber: 3, endLineNumber: 3 });
    expect(m?.startColumn).toBeLessThanOrEqual(6);
    expect(m?.endColumn).toBe(6);
    expect(m?.endColumn).toBeGreaterThanOrEqual(m?.startColumn ?? 0);
    const [n] = problemsToMarkers([problem(1, 99, 1, 100)], lineAt);
    expect(n).toMatchObject({ startColumn: 4, endColumn: 4 });
  });
});
