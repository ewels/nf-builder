import {
  type CommandResult,
  EDIT_COMMAND_KINDS,
  type EditCommand,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { applyCommand, commit, patchSequence } from "../../src/edit/apply";
import { applyPatches, PatchError } from "../../src/edit/patches";
import { stateFor, texts } from "./helpers";

const proc = "process B {\n    script:\n    'B'\n}\n";
const files = {
  "nextflow.config": "docker.enabled = false\n",
  "main.nf": `include { B } from './b.nf'\n\nworkflow {\n    B()\n}\n`,
  "b.nf": proc,
};
const target = { path: "main.nf", workflow: null };
const port = { node: "n", port: "p" };
const commands: Record<EditCommand["kind"], EditCommand> = {
  createProcess: { kind: "createProcess", name: "HELLO", caller: "main.nf" },
  addCall: { kind: "addCall", target, callee: "B" },
  connect: { kind: "connect", target, from: port, to: port },
  disconnect: { kind: "disconnect", target, port },
  deleteNode: { kind: "deleteNode", target, node: "n" },
  renameDeclaration: {
    kind: "renameDeclaration",
    path: "b.nf",
    name: "B",
    newName: "C",
  },
  replaceFileText: { kind: "replaceFileText", path: "main.nf", text: "" },
  setConfigOption: {
    kind: "setConfigOption",
    path: "nextflow.config",
    context: { profile: null, selector: null },
    option: ["docker", "enabled"],
    value: { kind: "boolean", value: true },
  },
  removeConfigOption: {
    kind: "removeConfigOption",
    path: "nextflow.config",
    context: { profile: null, selector: null },
    option: ["docker", "enabled"],
  },
  addConfigBlock: {
    kind: "addConfigBlock",
    path: "nextflow.config",
    context: { profile: null, selector: null },
    scope: ["docker"],
  },
  addConfigPlugin: {
    kind: "addConfigPlugin",
    path: "nextflow.config",
    id: "nf-schema@2.5.1",
  },
  removeConfigPlugin: {
    kind: "removeConfigPlugin",
    path: "nextflow.config",
    id: "nf-schema@2.5.1",
  },
  createFile: { kind: "createFile", path: "notes.txt" },
  createWorkflow: { kind: "createWorkflow", name: "SUB", caller: "main.nf" },
  addTake: {
    kind: "addTake",
    target: { path: "main.nf", workflow: null },
    name: "x",
    type: null,
  },
  addEmit: {
    kind: "addEmit",
    target: { path: "main.nf", workflow: null },
    name: "x",
    type: null,
  },
};

describe("F-111 applyCommand", () => {
  it("F-111 AR-20: commands and results are plain data, and applyCommand is pure", async () => {
    const state = await stateFor(files);
    const before = texts(state);
    for (const kind of EDIT_COMMAND_KINDS) {
      const command = commands[kind];
      expect(structuredClone(command)).toEqual(command);
      const one = applyCommand(state, command);
      const two = applyCommand(state, command);
      expect(one, kind).toEqual(two);
      expect(structuredClone(one), kind).toEqual(one);
      expect(typeof one.ok, kind).toBe("boolean");
    }
    expect(texts(state)).toEqual(before);
  });

  it("F-111 AR-23: the inverse of an accepted result restores the exact files, and commit writes the model", async () => {
    const state = await stateFor(files);
    const before = texts(state);
    const result = applyCommand(state, commands.createProcess);
    if (!result.ok) throw new Error(result.message);
    const remodelled = commit(state, result);
    expect(remodelled).toContain("main.nf");
    expect(state.model.paths()).toContain("modules/local/hello/main.nf");
    const undone = applyPatches(new Map(Object.entries(texts(state))), [
      ...result.inverse,
    ]);
    expect(Object.fromEntries(undone.files)).toEqual(before);
    // commit of the inverse's files returns the model to the start
    const back: CommandResult = {
      ok: true,
      patches: result.inverse,
      inverse: result.patches,
      files: [
        { path: "modules/local/hello/main.nf", text: null },
        { path: "main.nf", text: before["main.nf"] as string },
      ],
    };
    commit(state, back);
    expect(texts(state)).toEqual(before);
  });

  it("F-111 AR-24: a refused command returns a message and no patches", async () => {
    const state = await stateFor(files);
    const r = applyCommand(state, {
      kind: "createProcess",
      name: "not valid",
      caller: "main.nf",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message.length).toBeGreaterThan(10);
    expect(r).not.toHaveProperty("patches");
  });

  it("F-111 AR-20: createEditState passes a trace option to the model", async () => {
    const { createEditState } = await import("../../src/edit/apply");
    const events: string[] = [];
    await createEditState("26.10", [{ path: "main.nf", text: "" }], {
      trace: (e) => events.push(`${e.kind}:${e.path}`),
    });
    expect(events).toEqual(["parse:main.nf", "model:main.nf"]);
  });

  it("F-209 F-111: CreateProcess then AddCall touch main.nf twice, so their concatenated inverses throw PatchError, while patchSequence applies them in order", async () => {
    const state = await stateFor(files);
    const before = texts(state);
    const one = applyCommand(state, commands.createProcess);
    if (!one.ok) throw new Error(one.message);
    commit(state, one);
    const two = applyCommand(state, {
      kind: "addCall",
      target,
      callee: "HELLO",
    });
    if (!two.ok) throw new Error(two.message);
    commit(state, two);
    const after = texts(state);
    // the two inverses both patch main.nf
    expect(() =>
      applyPatches(new Map(Object.entries(after)), [
        ...two.inverse,
        ...one.inverse,
      ]),
    ).toThrow(PatchError);
    const back = patchSequence(state.model, [two.inverse, one.inverse]);
    commit(state, { files: back });
    expect(texts(state)).toEqual(before);
    const forward = patchSequence(state.model, [one.patches, two.patches]);
    commit(state, { files: forward });
    expect(texts(state)).toEqual(after);
  });

  it("F-209 AR-23: patchSequence returns each touched path's final text, null when deleted, omits a path created then deleted, and throws without changing the model", async () => {
    const state = await stateFor(files);
    const before = texts(state);
    const result = patchSequence(state.model, [
      [{ kind: "create", path: "tmp.nf", text: "// tmp\n" }],
      [{ kind: "delete", path: "tmp.nf" }],
      [{ kind: "delete", path: "b.nf" }],
      [
        {
          kind: "edit",
          path: "main.nf",
          edits: [{ start: 0, end: 0, text: "// one\n" }],
        },
      ],
      [
        {
          kind: "edit",
          path: "main.nf",
          edits: [{ start: 0, end: 0, text: "// two\n" }],
        },
      ],
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((f) => f.path === "b.nf")?.text).toBeNull();
    expect(result.find((f) => f.path === "main.nf")?.text).toBe(
      `// two\n// one\n${files["main.nf"]}`,
    );
    expect(result.some((f) => f.path === "tmp.nf")).toBe(false);
    expect(() =>
      patchSequence(state.model, [
        [{ kind: "delete", path: "b.nf" }],
        [{ kind: "delete", path: "b.nf" }],
      ]),
    ).toThrow(PatchError);
    expect(texts(state)).toEqual(before);
  });
});
