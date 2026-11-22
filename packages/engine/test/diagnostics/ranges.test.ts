import type { ParseProblem } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { problemRange } from "../../src/diagnostics/ranges";

const problem = (
  line: number,
  column: number,
  endLine: number,
  endColumn: number,
  message = "Unexpected input: 'x'",
): ParseProblem => ({
  source: "parser",
  message,
  line,
  column,
  endLine,
  endColumn,
});

describe("F-112 ranges", () => {
  it("F-112 LA-30: a parse problem's line and column map to its offsets", () => {
    expect(problemRange("ab\ncd", problem(2, 1, 2, 2))).toEqual({
      start: 3,
      end: 4,
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 2,
    });
  });

  it("F-112 LA-30: columns count code points, so an astral character is two offsets", () => {
    const range = problemRange("😀x y", problem(1, 2, 1, 3));
    expect([range.start, range.end]).toEqual([2, 3]);
    expect([range.column, range.endColumn]).toEqual([2, 3]);
  });

  it("F-112 LA-30: an invalid escape sequence's columns are UTF-16 units, as nf-lang reports them", () => {
    // "😀\q": the backslash is at UTF-16 offset 3, which lint prints as column 4
    const range = problemRange(
      '"😀\\q"',
      problem(1, 4, 1, 6, "Invalid escape sequence: '\\q'"),
    );
    expect([range.start, range.end]).toEqual([3, 5]);
    // reported back in code points like every other range
    expect([range.column, range.endColumn]).toEqual([3, 5]);
  });

  it("F-112 LA-30: the last line, an empty range and positions past the end are kept inside the text", () => {
    const text = "one\ntwo";
    expect(problemRange(text, problem(2, 4, 2, 4))).toMatchObject({
      start: 7,
      end: 7,
      line: 2,
      column: 4,
    });
    expect(problemRange(text, problem(9, 9, 9, 9))).toMatchObject({
      start: 7,
      end: 7,
    });
    expect(problemRange("", problem(1, 1, 1, 1))).toMatchObject({
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    });
  });
});
