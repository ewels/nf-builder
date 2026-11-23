import { describe, expect, it } from "vitest";
import { focusAfterRemoval, nextRowFocus } from "../src/problems/problem-keys";

const rows = [
  { key: "a", fixable: true },
  { key: "b", fixable: false },
  { key: "c", fixable: true },
];

describe("problem list keys", () => {
  it("F-309 UX-70 QA-11: ArrowUp and ArrowDown move between rows across files, Home and End go to the ends, ArrowRight and ArrowLeft move between a row's go and fix buttons", () => {
    const go = (key: string) => ({ key, part: "go" as const });
    expect(nextRowFocus(rows, go("a"), "ArrowDown")).toEqual(go("b"));
    expect(nextRowFocus(rows, go("b"), "ArrowDown")).toEqual(go("c"));
    // no wrapping at the ends
    expect(nextRowFocus(rows, go("c"), "ArrowDown")).toEqual(go("c"));
    expect(nextRowFocus(rows, go("a"), "ArrowUp")).toEqual(go("a"));
    expect(nextRowFocus(rows, go("c"), "ArrowUp")).toEqual(go("b"));
    expect(nextRowFocus(rows, go("b"), "Home")).toEqual(go("a"));
    expect(nextRowFocus(rows, go("b"), "End")).toEqual(go("c"));
    expect(nextRowFocus(rows, go("a"), "ArrowRight")).toEqual({
      key: "a",
      part: "fix",
    });
    expect(nextRowFocus(rows, { key: "a", part: "fix" }, "ArrowLeft")).toEqual(
      go("a"),
    );
    // a row without a fix has nothing to the right
    expect(nextRowFocus(rows, go("b"), "ArrowRight")).toEqual(go("b"));
    // up and down land on a row's go button
    expect(nextRowFocus(rows, { key: "a", part: "fix" }, "ArrowDown")).toEqual(
      go("b"),
    );
    // other keys are not ours; no focus yet starts at the first row
    expect(nextRowFocus(rows, go("a"), "Tab")).toBeNull();
    expect(nextRowFocus(rows, null, "ArrowDown")).toEqual(go("a"));
    expect(nextRowFocus([], null, "ArrowDown")).toBeNull();
  });

  it("F-309 QA-11: after a fix removes its row, focus goes to the row in its place, else the one before, else the list", () => {
    expect(focusAfterRemoval(["a", "b", "c"], ["a", "c"], "b")).toBe("c");
    expect(focusAfterRemoval(["a", "b", "c"], ["a", "b"], "c")).toBe("b");
    expect(focusAfterRemoval(["a"], [], "a")).toBeNull();
    expect(focusAfterRemoval(["a", "b"], ["a", "b"], "z")).toBeNull();
  });
});
