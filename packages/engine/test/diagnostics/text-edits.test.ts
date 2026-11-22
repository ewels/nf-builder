import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../../src/diagnostics/text-edits";

describe("F-112 text edits", () => {
  it("F-112 AR-05: applyTextEdits applies sorted, non-overlapping edits and rejects overlaps", () => {
    expect(applyTextEdits("abcdef", [])).toBe("abcdef");
    expect(
      applyTextEdits("abcdef", [
        { start: 4, end: 6, text: "Z" },
        { start: 0, end: 1, text: "XY" },
        { start: 2, end: 2, text: "-" },
      ]),
    ).toBe("XYb-cdZ");
    // touching edits do not overlap
    expect(
      applyTextEdits("abcd", [
        { start: 0, end: 2, text: "1" },
        { start: 2, end: 4, text: "2" },
      ]),
    ).toBe("12");
    expect(() =>
      applyTextEdits("abcdef", [
        { start: 0, end: 3, text: "" },
        { start: 2, end: 4, text: "" },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      applyTextEdits("abc", [{ start: 2, end: 9, text: "" }]),
    ).toThrow(RangeError);
    expect(() =>
      applyTextEdits("abc", [{ start: 2, end: 1, text: "" }]),
    ).toThrow(RangeError);
    expect(() =>
      applyTextEdits("abc", [{ start: -1, end: 1, text: "" }]),
    ).toThrow(RangeError);
  });
});
