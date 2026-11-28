import { EDIT_COMMAND_KINDS, type EditCommand } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { commandLabel } from "../../src/history/labels";

const target = { path: "main.nf", workflow: null };
const port = { node: "n", port: "p" };
const samples: Record<EditCommand["kind"], [EditCommand, string]> = {
  createProcess: [
    { kind: "createProcess", name: "REPORT", caller: "main.nf" },
    "Create process REPORT",
  ],
  addCall: [{ kind: "addCall", target, callee: "ALIGN" }, "Add call to ALIGN"],
  connect: [{ kind: "connect", target, from: port, to: port }, "Connect"],
  disconnect: [{ kind: "disconnect", target, port }, "Disconnect"],
  deleteNode: [{ kind: "deleteNode", target, node: "n" }, "Delete node"],
  renameDeclaration: [
    {
      kind: "renameDeclaration",
      path: "a.nf",
      name: "COUNT",
      newName: "COUNT_LINES",
    },
    "Rename COUNT to COUNT_LINES",
  ],
  replaceFileText: [
    { kind: "replaceFileText", path: "main.nf", text: "" },
    "Edit main.nf",
  ],
  setConfigOption: [
    {
      kind: "setConfigOption",
      path: "nextflow.config",
      context: { profile: null, selector: null },
      option: ["process", "memory"],
      value: { kind: "memory", amount: 8, unit: "GB" },
    },
    "Set process.memory",
  ],
  removeConfigOption: [
    {
      kind: "removeConfigOption",
      path: "nextflow.config",
      context: { profile: null, selector: null },
      option: ["docker", "enabled"],
    },
    "Remove docker.enabled",
  ],
  addConfigBlock: [
    {
      kind: "addConfigBlock",
      path: "nextflow.config",
      context: { profile: null, selector: null },
      scope: ["docker"],
    },
    "Add docker",
  ],
  addConfigPlugin: [
    { kind: "addConfigPlugin", path: "nextflow.config", id: "nf-schema@2.5.1" },
    "Add plugin nf-schema@2.5.1",
  ],
  removeConfigPlugin: [
    {
      kind: "removeConfigPlugin",
      path: "nextflow.config",
      id: "nf-schema@2.5.1",
    },
    "Remove plugin nf-schema@2.5.1",
  ],
  createFile: [
    { kind: "createFile", path: "notes/a.txt" },
    "Create notes/a.txt",
  ],
  createWorkflow: [
    { kind: "createWorkflow", name: "ALIGN", caller: "main.nf" },
    "Create workflow ALIGN",
  ],
  // F-307 AR-23: addTake and addEmit are labelled "Add take <n> to <WF>" / "Add emit <n> to <WF>"
  addTake: [
    {
      kind: "addTake",
      target: { path: "a.nf", workflow: "ALIGN" },
      name: "index",
      type: "Channel<String>",
    },
    "Add take index to ALIGN",
  ],
  addEmit: [
    {
      kind: "addEmit",
      target: { path: "a.nf", workflow: "ALIGN" },
      name: "log",
      type: null,
    },
    "Add emit log to ALIGN",
  ],
  // F-303 AR-23: updateDeclaration is labelled "Edit process <name>"
  updateDeclaration: [
    {
      kind: "updateDeclaration",
      path: "modules/local/align/main.nf",
      name: "ALIGN",
      form: {
        kind: "typedProcess",
        name: "ALIGN",
        description: "",
        docTags: null,
        inputs: [],
        stage: [],
        outputs: [],
        topics: [],
        directives: [],
        script: { label: "script", text: "'x'" },
        stub: null,
        kept: [],
      },
    },
    "Edit process ALIGN",
  ],
  // F-303 AR-23: moveFile is labelled with both paths
  moveFile: [
    {
      kind: "moveFile",
      path: "modules/local/a",
      newPath: "modules/local/b",
    },
    "Move modules/local/a to modules/local/b",
  ],
};

const context = (
  profile: string | null,
  kind: "withName" | "withLabel" | null = null,
  pattern = "big_mem",
) => ({ profile, selector: kind === null ? null : { kind, pattern } });

describe("F-601 config labels", () => {
  it("F-601 F-209: config commands have labels naming the option, context or plugin", () => {
    const set = (c: ReturnType<typeof context>): EditCommand => ({
      kind: "setConfigOption",
      path: "nextflow.config",
      context: c,
      option: ["process", "memory"],
      value: { kind: "memory", amount: 8, unit: "GB" },
    });
    expect(commandLabel(set(context(null, "withLabel")))).toBe(
      "Set process.memory for withLabel: big_mem",
    );
    expect(commandLabel(set(context("test")))).toBe(
      "Set process.memory in profile test",
    );
    expect(commandLabel(set(context("test", "withName", "A")))).toBe(
      "Set process.memory for withName: A in profile test",
    );
    const block = (
      c: ReturnType<typeof context>,
      scope: string[],
    ): EditCommand => ({
      kind: "addConfigBlock",
      path: "nextflow.config",
      context: c,
      scope,
    });
    expect(commandLabel(block(context(null, "withLabel"), []))).toBe(
      "Add selector withLabel: big_mem",
    );
    expect(commandLabel(block(context("test"), []))).toBe("Add profile test");
    expect(commandLabel(block(context("test"), ["docker"]))).toBe(
      "Add docker in profile test",
    );
    expect(
      commandLabel({
        kind: "removeConfigOption",
        path: "nextflow.config",
        context: context("t"),
        option: ["docker", "enabled"],
      }),
    ).toBe("Remove docker.enabled in profile t");
  });
});

describe("F-209 labels", () => {
  it("F-209 AR-21: commandLabel gives a sentence-case label for every EDIT_COMMAND_KINDS entry", () => {
    for (const kind of EDIT_COMMAND_KINDS) {
      const [command, label] = samples[kind];
      expect(commandLabel(command), kind).toBe(label);
    }
  });
});
