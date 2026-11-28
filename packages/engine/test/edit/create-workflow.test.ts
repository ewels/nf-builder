import { pack } from "@nf-builder/lang-2610";
import { describe, expect, it } from "vitest";
import { applyPatches } from "../../src/edit/patches";
import { accepted, commit, refused, stateFor, texts } from "./helpers";

const typedMain =
  "nextflow.enable.types = true\n\ninclude { A } from './modules/local/a/main.nf'\n\nworkflow {\n    A()\n}\n";
const a = "process A {\n    script:\n    'a'\n}\n";

describe("F-301 CreateWorkflow", () => {
  it("F-301 step 2 LA-12 AR-21: CreateWorkflow writes subworkflows/local/<lower>/main.nf with the flag and adds an explicit include to the caller", async () => {
    const state = await stateFor({
      "main.nf": typedMain,
      "modules/local/a/main.nf": a,
    });
    const r = accepted(state, {
      kind: "createWorkflow",
      name: "NEW_WORKFLOW",
      caller: "main.nf",
    });
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "main.nf",
      "subworkflows/local/new_workflow/main.nf",
    ]);
    const created = r.files.find((f) => f.path.startsWith("subworkflows/"));
    expect(created?.text).toBe(pack.scaffold.workflow("NEW_WORKFLOW"));
    expect(created?.text).toContain("nextflow.enable.types = true");
    expect(r.files.find((f) => f.path === "main.nf")?.text).toContain(
      "include { NEW_WORKFLOW } from './subworkflows/local/new_workflow/main.nf'",
    );
  });

  it("F-301 LA-12: the include is relative from a caller in a subdirectory and resolves", async () => {
    const state = await stateFor({
      "subworkflows/local/a/main.nf": "workflow A {\n}\n",
    });
    const r = accepted(state, {
      kind: "createWorkflow",
      name: "B",
      caller: "subworkflows/local/a/main.nf",
    });
    commit(state, r);
    expect(texts(state)["subworkflows/local/a/main.nf"]).toContain(
      "from '../b/main.nf'",
    );
    const binding = state.model.lookup("subworkflows/local/a/main.nf", "B");
    expect(binding?.kind).toBe("include");
    if (binding?.kind !== "include") throw new Error("not an include");
    expect(binding.entry.declaration?.kind).toBe("Workflow");
    expect(state.model.diagnostics()).toEqual([]);
  });

  it("F-301 AR-21: CreateWorkflow refuses an invalid name, an existing path, a name in scope, and a caller with top-level statements", async () => {
    const state = await stateFor({
      "main.nf": typedMain,
      "modules/local/a/main.nf": a,
      "subworkflows/local/b/main.nf": "workflow B {\n}\n",
      "README.md": "",
      "stmt.nf": "println('hi')\n",
    });
    const create = (name: string, caller = "main.nf") =>
      refused(state, { kind: "createWorkflow", name, caller });
    expect(create("1x").code).toBe("invalid");
    expect(create("1x").message).toContain("workflow name");
    expect(create("B").message).toContain("already exists");
    expect(create("A").message).toContain("already defined or included");
    expect(create("X", "nope.nf").code).toBe("not-found");
    expect(create("X", "README.md").code).toBe("invalid");
    expect(create("X", "stmt.nf").message).toContain(
      "statements outside a workflow",
    );
    expect(texts(state)["main.nf"]).toBe(typedMain);
  });

  it("F-301 AR-23: CreateWorkflow's inverse restores the exact bytes", async () => {
    const state = await stateFor({ "main.nf": typedMain });
    const before = texts(state);
    const r = accepted(state, {
      kind: "createWorkflow",
      name: "W",
      caller: "main.nf",
    });
    commit(state, r);
    const undone = applyPatches(new Map(Object.entries(texts(state))), [
      ...r.inverse,
    ]);
    expect(Object.fromEntries(undone.files)).toEqual(before);
  });
});
