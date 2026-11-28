import { join } from "node:path";
import type { EditCommand } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import type { EditState } from "../../src/edit/apply";
import { readTree } from "../model/read-tree";
import { accepted, commit, node, port, stateFor, texts } from "./helpers";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;

const entry = { path: "main.nf", workflow: null };

/** Runs `steps` one by one, each built from the projection of the state after the one before. */
async function run(
  start: string,
  steps: ((state: EditState) => EditCommand)[],
): Promise<Record<string, string>> {
  const state = await stateFor(
    Object.fromEntries(
      readTree(join(cases, start)).map((f) => [f.path, f.text]),
    ),
  );
  for (const step of steps) commit(state, accepted(state, step(state)));
  expect(state.model.diagnostics()).toEqual([]);
  return texts(state);
}

const goldens = {
  "f111-start-typed -> f111-edits-typed": {
    start: "f111-start-typed",
    expected: "f111-edits-typed",
    steps: [
      (): EditCommand => ({ kind: "addCall", target: entry, callee: "ALIGN" }),
      (s: EditState): EditCommand => ({
        kind: "connect",
        target: entry,
        from: port(s, "reads", "out"),
        to: port(s, "ALIGN@1", "sample"),
      }),
      (s: EditState): EditCommand => ({
        kind: "disconnect",
        target: entry,
        port: port(s, "ALIGN@1", "sample"),
      }),
      (s: EditState): EditCommand => ({
        kind: "connect",
        target: entry,
        from: port(s, "more", "out"),
        to: port(s, "ALIGN@1", "sample"),
      }),
      (s: EditState): EditCommand => ({
        kind: "connect",
        target: entry,
        from: port(s, "ALIGN@1", "out"),
        to: port(s, "COUNT@1", "aligned"),
      }),
      (s: EditState): EditCommand => ({
        kind: "deleteNode",
        target: entry,
        node: node(s, ".view@1").id,
      }),
      // a missing earlier positional input becomes `null`: PAIR(null, more)
      (): EditCommand => ({ kind: "addCall", target: entry, callee: "PAIR" }),
      (s: EditState): EditCommand => ({
        kind: "connect",
        target: entry,
        from: port(s, "more", "out"),
        to: port(s, "PAIR@1", "right"),
      }),
      // a multi-output call is read by output name, and moves above its consumer: COUNT_LINES(pair.b)
      (s: EditState): EditCommand => ({
        kind: "connect",
        target: entry,
        from: port(s, "PAIR@1", "b"),
        to: port(s, "COUNT@1", "aligned"),
      }),
      (): EditCommand => ({
        kind: "createProcess",
        name: "REPORT",
        caller: "main.nf",
      }),
      (): EditCommand => ({ kind: "addCall", target: entry, callee: "REPORT" }),
      (): EditCommand => ({
        kind: "renameDeclaration",
        path: "modules/local/count/main.nf",
        name: "COUNT",
        newName: "COUNT_LINES",
      }),
    ],
  },
  "template-blank -> f301-palette-adds": {
    start: "../../../packages/lang-2610/templates/blank",
    expected: "f301-palette-adds",
    steps: [
      (): EditCommand => ({
        kind: "createProcess",
        name: "NEW_PROCESS",
        caller: "main.nf",
      }),
      (): EditCommand => ({
        kind: "addCall",
        target: entry,
        callee: "NEW_PROCESS",
      }),
      (): EditCommand => ({
        kind: "createWorkflow",
        name: "NEW_WORKFLOW",
        caller: "main.nf",
      }),
      (): EditCommand => ({
        kind: "addCall",
        target: entry,
        callee: "NEW_WORKFLOW",
      }),
    ],
  },
  "template-blank -> f505-plugin": {
    start: "../../../packages/lang-2610/templates/blank",
    expected: "f505-plugin",
    steps: [
      (): EditCommand => ({
        kind: "addConfigPlugin",
        path: "nextflow.config",
        id: "nf-schema@3.1.0",
      }),
    ],
  },
  "f111-start-legacy -> f111-edits-legacy": {
    start: "f111-start-legacy",
    expected: "f111-edits-legacy",
    steps: [
      (s: EditState): EditCommand => ({
        kind: "connect",
        target: entry,
        from: {
          node: node(s, "LEGACY_COUNT@1").id,
          port: node(s, "LEGACY_COUNT@1").outputs[0]?.id ?? "out",
        },
        to: port(s, ".view@1", "in"),
      }),
      (): EditCommand => ({
        kind: "createProcess",
        name: "HELLO",
        caller: "main.nf",
      }),
      (): EditCommand => ({ kind: "addCall", target: entry, callee: "HELLO" }),
    ],
  },
};

describe("F-111 oracle goldens", () => {
  for (const [name, g] of Object.entries(goldens))
    it(`F-111 F-301 F-505 IO-33 step 2 step 3 ADR-0011: the scripted edits on ${g.start} produce tools/oracle/cases/${g.expected} byte for byte (${name})`, async () => {
      const result = await run(g.start, g.steps);
      for (const [path, text] of Object.entries(result))
        await expect(text).toMatchFileSnapshot(join(cases, g.expected, path));
      // no files beyond the result
      expect(readTree(join(cases, g.expected)).map((f) => f.path)).toEqual(
        Object.keys(result).sort(),
      );
    });
});
