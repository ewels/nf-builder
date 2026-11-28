import { describe, expect, it } from "vitest";
import { freshDefinitionName, NEW_NAME_BASE } from "../../src/edit/fresh-name";
import { definitionPath } from "../../src/edit/names";
import { accepted, stateFor } from "./helpers";

const main = "workflow {\n}\n";
const fresh = (
  state: Awaited<ReturnType<typeof stateFor>>,
  kind: "process" | "workflow",
  caller = "main.nf",
) => freshDefinitionName(state.model, state.catalogue, { kind, caller });

describe("F-301 fresh names", () => {
  it("F-301 LA-12: freshDefinitionName gives NEW_PROCESS, then NEW_PROCESS_2 when the name is in scope, its directory holds any file (any case), or it is a builtin", async () => {
    expect(NEW_NAME_BASE).toEqual({
      process: "NEW_PROCESS",
      workflow: "NEW_WORKFLOW",
    });
    expect(definitionPath("process", "NEW_PROCESS")).toBe(
      "modules/local/new_process/main.nf",
    );
    expect(definitionPath("workflow", "X_Y")).toBe(
      "subworkflows/local/x_y/main.nf",
    );
    expect(fresh(await stateFor({ "main.nf": main }), "process")).toBe(
      "NEW_PROCESS",
    );
    // in scope
    const inScope = await stateFor({
      "main.nf": `include { NEW_PROCESS } from './p.nf'\n\n${main}`,
      "p.nf": "process NEW_PROCESS {\n    script:\n    'x'\n}\n",
    });
    expect(fresh(inScope, "process")).toBe("NEW_PROCESS_2");
    // directory holds any file, in any case
    const dir = await stateFor({
      "main.nf": main,
      "modules/local/new_process/notes.txt": "",
    });
    expect(fresh(dir, "process")).toBe("NEW_PROCESS_2");
    const both = await stateFor({
      "main.nf": main,
      "modules/local/new_process/notes.txt": "",
      "modules/local/new_process_2/main.nf": "",
    });
    expect(fresh(both, "process")).toBe("NEW_PROCESS_3");
  });

  it("F-301 LA-12: process and workflow names are fresh independently, and a CreateProcess with the name is accepted", async () => {
    const state = await stateFor({
      "main.nf": main,
      "modules/local/new_process/main.nf": "",
    });
    expect(fresh(state, "workflow")).toBe("NEW_WORKFLOW");
    expect(fresh(state, "process")).toBe("NEW_PROCESS_2");
    accepted(state, {
      kind: "createProcess",
      name: fresh(state, "process"),
      caller: "main.nf",
    });
    accepted(state, {
      kind: "createWorkflow",
      name: fresh(state, "workflow"),
      caller: "main.nf",
    });
  });
});
