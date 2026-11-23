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
};

describe("F-209 labels", () => {
  it("F-209 AR-21: commandLabel gives a sentence-case label for every EDIT_COMMAND_KINDS entry", () => {
    for (const kind of EDIT_COMMAND_KINDS) {
      const [command, label] = samples[kind];
      expect(commandLabel(command), kind).toBe(label);
    }
  });
});
