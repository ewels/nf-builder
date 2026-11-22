import { pack } from "@nf-builder/lang-2610";
import { describe, expect, it } from "vitest";
import { accepted, commit, refused, stateFor, texts } from "./helpers";

const typedMain =
  "nextflow.enable.types = true\n\ninclude { A } from './modules/local/a/main.nf'\n\nworkflow {\n    A()\n}\n";
const a = "process A {\n    script:\n    'a'\n}\n";

describe("F-111 CreateProcess", () => {
  it("F-111 step 2 LA-12 LA-11: CreateProcess writes modules/local/<name>/main.nf with nextflow.enable.types = true and adds the include", async () => {
    const state = await stateFor({
      "main.nf": typedMain,
      "modules/local/a/main.nf": a,
    });
    const r = accepted(state, {
      kind: "createProcess",
      name: "HELLO",
      caller: "main.nf",
    });
    const created = r.files.find((f) =>
      f.path.startsWith("modules/local/hello"),
    );
    expect(created).toEqual({
      path: "modules/local/hello/main.nf",
      text: pack.scaffold.process("HELLO"),
    });
    expect(created?.text).toContain("nextflow.enable.types = true");
    const main = r.files.find((f) => f.path === "main.nf")?.text;
    expect(main).toBe(
      typedMain.replace(
        "include { A } from './modules/local/a/main.nf'\n",
        "include { A } from './modules/local/a/main.nf'\ninclude { HELLO } from './modules/local/hello/main.nf'\n",
      ),
    );
  });

  it("F-111 LA-12 AR-03: the include is relative to the calling script and resolves to the new file", async () => {
    for (const caller of ["main.nf", "subworkflows/local/x/main.nf"]) {
      const state = await stateFor({
        [caller]:
          "workflow W {\n    take:\n    x\n\n    main:\n    x.view()\n}\n",
      });
      const r = accepted(state, {
        kind: "createProcess",
        name: "HELLO",
        caller,
      });
      commit(state, r);
      expect(state.model.diagnostics(), caller).toEqual([]);
      const binding = state.model.lookup(caller, "HELLO");
      expect(binding?.kind).toBe("include");
      if (binding?.kind !== "include") throw new Error("not an include");
      expect(binding.include.target).toMatchObject({
        kind: "file",
        path: "modules/local/hello/main.nf",
      });
      expect(binding.entry.declaration?.kind).toBe("Process");
    }
  });

  it("F-111 LA-14: CreateProcess from a legacy script includes the typed module without touching its definitions", async () => {
    const legacy = "include { L } from './l.nf'\n\nworkflow {\n    L(1)\n}\n";
    const state = await stateFor({
      "main.nf": legacy,
      "l.nf": "process L {\n    input:\n    val x\n\n    script:\n    'l'\n}\n",
    });
    const r = accepted(state, {
      kind: "createProcess",
      name: "T",
      caller: "main.nf",
    });
    commit(state, r);
    const after = texts(state)["main.nf"];
    expect(after).toBe(
      "include { L } from './l.nf'\ninclude { T } from './modules/local/t/main.nf'\n\nworkflow {\n    L(1)\n}\n",
    );
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
    expect(state.model.diagnostics()).toEqual([]);
  });

  it("F-111: CreateProcess refuses an invalid name, an existing module path and a name already in scope", async () => {
    const state = await stateFor({
      "main.nf": typedMain,
      "modules/local/a/main.nf": a,
      "modules/local/b/main.nf": a,
      "README.md": "",
    });
    const create = (name: string, caller = "main.nf") =>
      refused(state, { kind: "createProcess", name, caller });
    expect(create("1x").code).toBe("invalid");
    expect(create("a-b").code).toBe("invalid");
    expect(create("B").code).toBe("invalid"); // modules/local/b/main.nf exists
    expect(create("A").code).toBe("invalid"); // already included
    expect(create("X", "nope.nf").code).toBe("not-found");
    expect(create("X", "README.md").code).toBe("invalid");
    expect(texts(state)["main.nf"]).toBe(typedMain);
  });

  it("F-111 AR-24: CreateProcess refuses a script of top-level statements up front, as invalid rather than as a result that doesn't parse", async () => {
    const text = "println('hi')\ndef x = 1\n";
    const state = await stateFor({ "main.nf": text });
    const r = refused(state, {
      kind: "createProcess",
      name: "X",
      caller: "main.nf",
    });
    expect(r.code).toBe("invalid");
    expect(r.message).toContain("statements outside a workflow");
    expect(texts(state)["main.nf"]).toBe(text);
  });
});
