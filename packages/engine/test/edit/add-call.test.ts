import { describe, expect, it } from "vitest";
import { projectorFor } from "../projection/open";
import { accepted, commit, refused, stateFor, texts } from "./helpers";

const proc = (n: string) => `process ${n} {\n    script:\n    '${n}'\n}\n`;
const main = [
  "include { A } from './a.nf'",
  "",
  proc("B"),
  "workflow {",
  "    A()",
  "}",
  "",
  "workflow W {",
  "    take:",
  "    x",
  "",
  "    main:",
  "    B()",
  "",
  "    emit:",
  "    x",
  "}",
  "",
].join("\n");
const files = { "main.nf": main, "a.nf": proc("A") };
const target = { path: "main.nf", workflow: null };

describe("F-111 AddCall", () => {
  it("F-111 AR-21 AR-10: AddCall appends a bare call and the projection gains a call node", async () => {
    const state = await stateFor(files);
    const count = async () => {
      const p = (await projectorFor(state.model)).project("main.nf", null);
      return p?.nodes.filter((n) => n.kind === "call").length ?? -1;
    };
    expect(await count()).toBe(1);
    commit(state, accepted(state, { kind: "addCall", target, callee: "B" }));
    expect(await count()).toBe(2);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
  });

  it("F-111 AR-22 LA-45: AddCall reprints only the target workflow", async () => {
    const state = await stateFor(files);
    const r = accepted(state, { kind: "addCall", target, callee: "B" });
    const after = r.files[0]?.text as string;
    expect(after).toBe(main.replace("    A()\n}", "    A()\n    B()\n}"));
    expect(r.patches).toHaveLength(1);
    const edit = r.patches[0];
    if (edit?.kind !== "edit") throw new Error("not an edit");
    expect(edit.edits).toHaveLength(1);
    expect(edit.edits[0]?.start).toBe(main.indexOf("workflow {"));
  });

  it("F-111: AddCall works on an empty workflow, one with take and emit, and a legacy workflow", async () => {
    const state = await stateFor({
      "main.nf": `${proc("B")}\nworkflow {\n}\n\nworkflow W {\n    take:\n    x\n\n    emit:\n    x\n}\n`,
    });
    const empty = accepted(state, { kind: "addCall", target, callee: "B" });
    expect(empty.files[0]?.text).toContain("workflow {\n    B()\n}");
    const onlyTake = accepted(state, {
      kind: "addCall",
      target: { path: "main.nf", workflow: "W" },
      callee: "B",
    });
    expect(onlyTake.files[0]?.text).toMatch(
      /workflow W \{\n {4}take:\n {4}x\n\n {4}main:\n {4}B\(\)\n\n {4}emit:\n {4}x\n\}/,
    );
    commit(state, onlyTake);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
    const typed = await stateFor({
      "main.nf": `nextflow.enable.types = true\n\n${proc("B")}\nworkflow {\n    B()\n}\n`,
    });
    const t = accepted(typed, { kind: "addCall", target, callee: "B" });
    expect(t.files[0]?.text).toContain("    B()\n    B()\n}");
  });

  it("F-111: AddCall refuses names that aren't callable in scope, and a self-call", async () => {
    const state = await stateFor({
      ...files,
      "f.nf": "def helper() {\n    return 1\n}\n",
      "main.nf": `${main}\ninclude { helper } from './f.nf'\n`,
    });
    const add = (callee: string, workflow: string | null = null) =>
      refused(state, {
        kind: "addCall",
        target: { path: "main.nf", workflow },
        callee,
      });
    expect(add("NOPE").code).toBe("invalid");
    expect(add("helper").code).toBe("invalid");
    expect(add("W", "W").code).toBe("invalid");
    expect(add("B", "MISSING").code).toBe("not-found");
    expect(
      refused(state, {
        kind: "addCall",
        target: { path: "zzz.nf", workflow: null },
        callee: "B",
      }).code,
    ).toBe("not-found");
    expect(texts(state)["main.nf"]).toContain("include { helper }");
  });
});

describe("F-111 AddCall and the formatter's empty-statement rule", () => {
  it("F-111 AR-22 LA-45: AddCall on a workflow with `if (x) ;` prints the braced form nf-lang's formatter writes, and the result lints and runs", async () => {
    const source =
      "process A {\n    script:\n    'echo a'\n}\n\nworkflow {\n    x = true\n    if (x) ;\n    A()\n}\n".replace(
        "workflow",
        "process B {\n    script:\n    'echo b'\n}\n\nworkflow",
      );
    const state = await stateFor({ "main.nf": source });
    const r = accepted(state, { kind: "addCall", target, callee: "B" });
    const text = r.files[0]?.text as string;
    expect(text).toContain("if (x) {");
    expect(text).not.toContain("if (x) ;");
    // the oracle case f111-addcall-empty-if holds this text; `pnpm oracle` lints it with the pinned Nextflow and stub-runs it
    await expect(text).toMatchFileSnapshot(
      new URL(
        "../../../../tools/oracle/cases/f111-addcall-empty-if/main.nf",
        import.meta.url,
      ).pathname,
    );
  });
});
