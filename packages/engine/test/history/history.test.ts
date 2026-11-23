import type { TextPatch } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  HISTORY_LIMITS,
  History,
  patchUnits,
  type StepPart,
} from "../../src/history/history";

const edit = (path: string, text: string): TextPatch => ({
  kind: "edit",
  path,
  edits: [{ start: 0, end: 0, text }],
});
const part = (tag: string, text = tag): StepPart => ({
  patches: [edit("main.nf", `do-${tag}${text}`)],
  inverse: [edit("main.nf", `undo-${tag}${text}`)],
});

describe("F-209 history", () => {
  it("F-209 AR-23: each recorded command is one step; undo and redo move the top step between the stacks", () => {
    const h = new History();
    expect(h.status()).toEqual(EMPTY_HISTORY);
    expect(h.undoLists()).toBeNull();
    expect(h.redoLists()).toBeNull();
    h.record(part("a"), "First", null);
    h.record(part("b"), "Second", null);
    expect(h.status()).toEqual({
      undo: "Second",
      redo: null,
      undoCount: 2,
      redoCount: 0,
    });
    expect(h.undoLists()).toEqual([part("b").inverse]);
    expect(h.undone()).toBe("Second");
    expect(h.status()).toEqual({
      undo: "First",
      redo: "Second",
      undoCount: 1,
      redoCount: 1,
    });
    expect(h.redoLists()).toEqual([part("b").patches]);
    expect(h.redone()).toBe("Second");
    expect(h.status().undoCount).toBe(2);
    expect(h.status().redoCount).toBe(0);
  });

  it("F-209 AR-23: recording after an undo clears the redo stack", () => {
    const h = new History();
    h.record(part("a"), "First", null);
    h.record(part("b"), "Second", null);
    h.undone();
    h.record(part("c"), "Third", null);
    expect(h.status()).toEqual({
      undo: "Third",
      redo: null,
      undoCount: 2,
      redoCount: 0,
    });
    expect(h.redoLists()).toBeNull();
  });

  it("F-209 AR-23: a command with no patches records no step, leaves both stacks alone and keeps an open group open", () => {
    const h = new History();
    h.record(part("a"), "First", null);
    h.record(part("b"), "Second", null);
    h.undone();
    const before = h.status();
    h.record({ patches: [], inverse: [] }, "Nothing", null);
    expect(h.status()).toEqual(before);
    const g = new History();
    g.record(part("a"), "Group", "g");
    g.record({ patches: [], inverse: [] }, "Nothing", "g");
    g.record(part("b"), "Ignored", "g");
    expect(g.status().undoCount).toBe(1);
    expect(g.undoLists()).toHaveLength(2);
  });

  it("F-209 F-301 F-310: commands recorded in a row with one group make one step; undo lists the inverses newest first and redo lists the patches in order; undo, redo, seal or another group start a new step", () => {
    const h = new History();
    h.record(part("a"), "Group", "g");
    h.record(part("b"), "Group", "g");
    h.record(part("c"), "Group", "g");
    expect(h.status().undoCount).toBe(1);
    expect(h.undoLists()).toEqual([
      part("c").inverse,
      part("b").inverse,
      part("a").inverse,
    ]);
    h.undone();
    expect(h.redoLists()).toEqual([
      part("a").patches,
      part("b").patches,
      part("c").patches,
    ]);
    h.redone();
    // after an undo and redo the group is sealed
    h.record(part("d"), "Group", "g");
    expect(h.status().undoCount).toBe(2);
    h.seal();
    h.record(part("e"), "Group", "g");
    expect(h.status().undoCount).toBe(3);
    h.record(part("f"), "Other", "h");
    expect(h.status().undoCount).toBe(4);
    h.record(part("g"), "Plain", null);
    h.record(part("h"), "Plain", null);
    expect(h.status().undoCount).toBe(6);
  });

  it("F-209: beyond 100 steps or 8,000,000 units the oldest steps are dropped; a single oversized step is kept alone", () => {
    expect(HISTORY_LIMITS).toEqual({ steps: 100, units: 8_000_000 });
    const steps = new History({ steps: 3, units: 1_000_000 });
    for (let i = 0; i < 5; i++) steps.record(part(String(i)), `S${i}`, null);
    expect(steps.status().undoCount).toBe(3);
    expect(steps.status().undo).toBe("S4");
    steps.undone();
    steps.undone();
    expect(steps.undone()).toBe("S2");
    expect(steps.undoLists()).toBeNull();

    const one = part("x");
    const size = patchUnits(one.patches) + patchUnits(one.inverse);
    const sized = new History({ steps: 100, units: size * 2 });
    for (let i = 0; i < 4; i++) sized.record(part("x"), `S${i}`, null);
    expect(sized.status().undoCount).toBe(2);
    const big = new History({ steps: 100, units: 10 });
    big.record(part("a"), "A", null);
    big.record(part("b"), "B", null);
    expect(big.status()).toMatchObject({ undo: "B", undoCount: 1 });
    big.record(part("c", "z".repeat(100)), "Huge", null);
    expect(big.status()).toMatchObject({ undo: "Huge", undoCount: 1 });
  });

  it("F-209: a group takes its first command's label option, else that command's label", () => {
    const h = new History();
    h.record(part("a"), "First label", "g");
    h.record(part("b"), "Second label", "g");
    expect(h.status().undo).toBe("First label");
  });

  it("F-209: patchUnits sums the edit, create and path string lengths", () => {
    expect(
      patchUnits([
        edit("ab", "xyz"),
        { kind: "create", path: "c", text: "tttt" },
        { kind: "delete", path: "dd" },
      ]),
    ).toBe(2 + 3 + 1 + 4 + 2);
  });
});
