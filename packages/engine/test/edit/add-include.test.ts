import { describe, expect, it } from "vitest";
import { applyPatches } from "../../src/edit/patches";
import { accepted, commit, main, refused, stateFor, texts } from "./helpers";

const B = "process B {\n    script:\n    'b'\n}\n";
const files = {
  "b.nf": B,
  "modules/local/c/main.nf": "process C {\n    script:\n    'c'\n}\n",
  "main.nf": "include { B } from './b.nf'\n\nworkflow {\n    B()\n}\n",
};

describe("F-310 AddInclude", () => {
  it("F-310 AR-21: AddInclude inserts `include { X as X_2 } from '<rel>'` at an item boundary, and the inverse restores the bytes", async () => {
    const state = await stateFor(files);
    const before = texts(state);
    const r = accepted(state, {
      kind: "addInclude",
      caller: "main.nf",
      name: "B",
      alias: "B_2",
      source: "./b.nf",
    });
    expect(main(r)).toBe(
      "include { B } from './b.nf'\ninclude { B as B_2 } from './b.nf'\n\nworkflow {\n    B()\n}\n",
    );
    commit(state, r);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
    expect(state.model.lookup("main.nf", "B_2")?.kind).toBe("include");
    const back = applyPatches(new Map(Object.entries(texts(state))), r.inverse);
    expect(Object.fromEntries(back.files)).toEqual(before);
  });

  it("F-310 AR-21: AddInclude without an alias includes the name as it is", async () => {
    const state = await stateFor(files);
    const r = accepted(state, {
      kind: "addInclude",
      caller: "main.nf",
      name: "C",
      alias: null,
      source: "./modules/local/c/main.nf",
    });
    expect(main(r)).toContain(
      "include { B } from './b.nf'\ninclude { C } from './modules/local/c/main.nf'\n",
    );
  });

  it("F-310: refuses a name or alias already bound in the caller, a source outside the project or missing, and a caller with top-level statements", async () => {
    const state = await stateFor({
      ...files,
      "stmt.nf": "x = 1\n\nworkflow {\n}\n",
    });
    const add = (over: object) =>
      refused(state, {
        kind: "addInclude",
        caller: "main.nf",
        name: "C",
        alias: null,
        source: "./modules/local/c/main.nf",
        ...over,
      });
    expect(add({ name: "B", source: "./b.nf" }).message).toContain("B");
    expect(add({ alias: "B" }).code).toBe("invalid");
    expect(add({ source: "../outside.nf" }).message).toContain("outside");
    expect(add({ source: "./nope.nf" }).code).toBe("invalid");
    expect(add({ name: "not valid" }).code).toBe("invalid");
    expect(add({ caller: "stmt.nf" }).message).toContain(
      "outside a workflow block",
    );
    expect(add({ caller: "gone.nf" }).code).toBe("not-found");
    expect(texts(state)["main.nf"]).toBe(files["main.nf"]);
  });
});
