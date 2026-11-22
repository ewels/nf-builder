import { describe, expect, it } from "vitest";
import { hasPosition, NO_RANGE, PrintError, type Range } from "../src/index.ts";

describe("printer types", () => {
  it("F-110: NO_RANGE has no position", () => {
    const parsed: Range = {
      start: 0,
      end: 3,
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 4,
    };
    expect(hasPosition(NO_RANGE)).toBe(false);
    expect(NO_RANGE).toEqual({
      start: -1,
      end: -1,
      line: -1,
      column: -1,
      endLine: -1,
      endColumn: -1,
    });
    expect(hasPosition(parsed)).toBe(true);
  });

  it("F-110: PrintError carries the node that could not be printed", () => {
    const error = new PrintError("cannot print", { kind: "Import" });
    expect(error).toBeInstanceOf(Error);
    expect(error.node.kind).toBe("Import");
    expect(error.message).toBe("cannot print");
  });
});
