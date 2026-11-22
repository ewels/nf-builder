import type { TextEdit, TextPatch } from "@nf-builder/lang-core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyPatches, diffText, PatchError } from "../../src/edit/patches";

const files = (entries: Record<string, string>) =>
  new Map(Object.entries(entries));

// Texts with CRLF, LF and astral characters (surrogate pairs), so offsets are UTF-16 units.
const textArb = fc.string({
  unit: fc.constantFrom(
    "a",
    "b",
    " ",
    "\n",
    "\r\n",
    "\u{1F600}",
    "é",
    "{",
    "}",
  ),
  maxLength: 40,
});

/** Sorted, non-overlapping edits drawn from cut points into `text`. */
const editsArb = (text: string) =>
  fc
    .tuple(
      fc.array(fc.nat({ max: text.length }), { maxLength: 6 }),
      fc.array(textArb, { minLength: 6, maxLength: 6 }),
    )
    .map(([cuts, texts]) => {
      const sorted = [...cuts].sort((a, b) => a - b);
      const edits: TextEdit[] = [];
      for (let i = 0; i + 1 < sorted.length; i += 2) {
        edits.push({
          start: sorted[i] as number,
          end: sorted[i + 1] as number,
          text: texts[i] as string,
        });
      }
      return edits;
    });

describe("F-111 AR-23: patches and their inverse", () => {
  it("F-111 AR-23: a patch then its inverse restores exact bytes", () => {
    const scenario = fc
      .record({
        a: textArb,
        b: textArb,
        c: textArb,
        created: textArb,
      })
      .chain((t) =>
        fc.record({
          t: fc.constant(t),
          editsA: editsArb(t.a),
          editsB: editsArb(t.b),
          deleteC: fc.boolean(),
        }),
      );
    fc.assert(
      fc.property(scenario, ({ t, editsA, editsB, deleteC }) => {
        const before = files({ "a.nf": t.a, "b.nf": t.b, "c.nf": t.c });
        const patches: TextPatch[] = [
          { kind: "edit", path: "a.nf", edits: editsA },
          { kind: "edit", path: "b.nf", edits: editsB },
          { kind: "create", path: "new.nf", text: t.created },
        ];
        if (deleteC) patches.push({ kind: "delete", path: "c.nf" });
        const snapshot = new Map(before);
        const after = applyPatches(before, patches);
        // the input map is not changed
        expect(before).toEqual(snapshot);
        expect(after.files.get("new.nf")).toBe(t.created);
        expect(after.files.has("c.nf")).toBe(!deleteC);
        const back = applyPatches(after.files, after.inverse);
        expect([...back.files.entries()].sort()).toEqual(
          [...before.entries()].sort(),
        );
        // and the inverse of the inverse is the patch again
        const again = applyPatches(back.files, back.inverse);
        expect([...again.files.entries()].sort()).toEqual(
          [...after.files.entries()].sort(),
        );
      }),
      { seed: 111, numRuns: 200 },
    );
  });

  it("F-111 AR-23: edits apply against the original offsets, in order", () => {
    const r = applyPatches(files({ "a.nf": "0123456789" }), [
      {
        kind: "edit",
        path: "a.nf",
        edits: [
          { start: 1, end: 3, text: "XYZ" },
          { start: 3, end: 3, text: "-" },
          { start: 8, end: 10, text: "" },
        ],
      },
    ]);
    expect(r.files.get("a.nf")).toBe("0XYZ-34567");
    expect(r.inverse).toEqual([
      {
        kind: "edit",
        path: "a.nf",
        edits: [
          { start: 1, end: 4, text: "12" },
          { start: 4, end: 5, text: "" },
          { start: 10, end: 10, text: "89" },
        ],
      },
    ]);
  });

  it("F-111 AR-20: overlapping or out-of-range edits, two patches for one path, creating an existing file and deleting a missing one throw PatchError", () => {
    const base = files({ "a.nf": "abcdef" });
    const edit = (edits: TextEdit[], path = "a.nf"): TextPatch => ({
      kind: "edit",
      path,
      edits,
    });
    const bad: TextPatch[][] = [
      [
        edit([
          { start: 0, end: 3, text: "" },
          { start: 2, end: 4, text: "" },
        ]),
      ],
      [
        edit([
          { start: 4, end: 5, text: "" },
          { start: 0, end: 1, text: "" },
        ]),
      ],
      [edit([{ start: 2, end: 1, text: "" }])],
      [edit([{ start: 0, end: 7, text: "" }])],
      [edit([{ start: -1, end: 1, text: "" }])],
      [edit([{ start: 0, end: 1, text: "" }], "missing.nf")],
      [edit([]), { kind: "delete", path: "a.nf" }],
      [{ kind: "create", path: "a.nf", text: "" }],
      [{ kind: "delete", path: "nope.nf" }],
      [
        { kind: "create", path: "n.nf", text: "" },
        { kind: "create", path: "n.nf", text: "" },
      ],
    ];
    for (const patches of bad)
      expect(
        () => applyPatches(base, patches),
        JSON.stringify(patches),
      ).toThrow(PatchError);
  });

  it("F-111: diffText gives one edit spanning only the changed text", () => {
    expect(diffText("same", "same")).toBeNull();
    expect(diffText("abcdef", "abXef")).toEqual({
      start: 2,
      end: 4,
      text: "X",
    });
    expect(diffText("abc", "abXc")).toEqual({ start: 2, end: 2, text: "X" });
    expect(diffText("abXc", "abc")).toEqual({ start: 2, end: 3, text: "" });
    expect(diffText("", "x")).toEqual({ start: 0, end: 0, text: "x" });
    // an overlapping prefix and suffix is counted once
    expect(diffText("aaa", "aaaa")).toEqual({ start: 3, end: 3, text: "a" });
    // a surrogate pair is never split: U+1F600 and U+1F601 share their first unit
    const e = diffText("a\u{1F600}b", "a\u{1F601}b");
    expect(e).toEqual({ start: 1, end: 3, text: "\u{1F601}" });
  });

  it("F-111 AR-23: diffText applied to the text gives the new text", () => {
    fc.assert(
      fc.property(textArb, textArb, (a, b) => {
        const e = diffText(a, b);
        if (e === null) return a === b;
        const out = a.slice(0, e.start) + e.text + a.slice(e.end);
        return out === b && e.start <= e.end && e.end <= a.length;
      }),
      { seed: 111, numRuns: 300 },
    );
  });
});
