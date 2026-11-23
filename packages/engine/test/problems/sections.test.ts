import type { Diagnostic } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { countDiagnostics } from "../../src/diagnostics/diagnose";
import { problemCounts, problemKey, problemSections } from "../../src/problems";

const diag = (
  path: string,
  start: number,
  severity: Diagnostic["severity"],
  code = "c",
): Diagnostic => ({
  path,
  range: {
    start,
    end: start + 1,
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 2,
  },
  severity,
  message: `${code} at ${start}`,
  code,
});

describe("F-309 problem sections", () => {
  it("F-309 UX-03 LA-34 LA-35: errors and warnings go to Problems and suggestions to Suggestions, each grouped by file in path order", () => {
    const s = problemSections([
      diag("b.nf", 1, "warning"),
      diag("a.nf", 1, "suggestion"),
      diag("a.nf", 2, "error"),
      diag("c/main.nf", 1, "suggestion"),
    ]);
    expect(s.problems.map((g) => g.path)).toEqual(["a.nf", "b.nf"]);
    expect(s.suggestions.map((g) => g.path)).toEqual(["a.nf", "c/main.nf"]);
    expect(
      s.problems.flatMap((g) => g.diagnostics).map((d) => d.severity),
    ).toEqual(["error", "warning"]);
    expect(
      s.suggestions
        .flatMap((g) => g.diagnostics)
        .every((d) => d.severity === "suggestion"),
    ).toBe(true);
  });

  it("F-309: within a file, Problems lists errors before warnings, each in source order; Suggestions keep source order", () => {
    const s = problemSections([
      diag("a.nf", 5, "warning", "w1"),
      diag("a.nf", 9, "error", "e2"),
      diag("a.nf", 2, "warning", "w0"),
      diag("a.nf", 3, "error", "e1"),
      diag("a.nf", 8, "suggestion", "s2"),
      diag("a.nf", 1, "suggestion", "s1"),
    ]);
    expect(s.problems[0]?.diagnostics.map((d) => d.code)).toEqual([
      "e1",
      "e2",
      "w0",
      "w1",
    ]);
    expect(s.suggestions[0]?.diagnostics.map((d) => d.code)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("F-309 UX-03: problemCounts counts errors plus warnings as problems and suggestions apart", () => {
    const list = [
      diag("a.nf", 1, "error"),
      diag("a.nf", 2, "warning"),
      diag("a.nf", 3, "warning"),
      diag("a.nf", 4, "suggestion"),
    ];
    const c = problemCounts(list);
    expect(c).toEqual({ errors: 1, warnings: 2, suggestions: 1, problems: 3 });
    expect(c).toMatchObject(countDiagnostics(list));
    expect(problemSections(list).counts).toEqual(c);
    expect(problemCounts([])).toEqual({
      errors: 0,
      warnings: 0,
      suggestions: 0,
      problems: 0,
    });
  });

  it("F-309: problemKey survives structuredClone and tells apart two diagnostics at one range with different codes", () => {
    const a = diag("a.nf", 1, "warning", "x");
    const b = diag("a.nf", 1, "warning", "y");
    expect(problemKey(structuredClone(a))).toBe(problemKey(a));
    expect(problemKey(a)).not.toBe(problemKey(b));
  });
});
