import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { EditCommand } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { readTree } from "../model/read-tree";
import {
  accepted,
  commit,
  type EditStateOf,
  node,
  port,
  stateFor,
  texts,
} from "./helpers";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;

const files = (dir: string): string[] => {
  const out: string[] = [];
  const visit = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) visit(path);
      else out.push(path);
    }
  };
  visit("");
  return out.sort();
};

const entry = { path: "main.nf", workflow: null };

/** Runs `steps` one by one, each built from the projection of the state after the one before. */
async function run(
  start: string,
  steps: ((state: EditStateOf) => EditCommand)[],
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
      (s: EditStateOf): EditCommand => ({
        kind: "connect",
        target: entry,
        from: port(s, "reads", "out"),
        to: port(s, "ALIGN@1", "sample"),
      }),
      (s: EditStateOf): EditCommand => ({
        kind: "disconnect",
        target: entry,
        port: port(s, "ALIGN@1", "sample"),
      }),
      (s: EditStateOf): EditCommand => ({
        kind: "connect",
        target: entry,
        from: port(s, "more", "out"),
        to: port(s, "ALIGN@1", "sample"),
      }),
      (s: EditStateOf): EditCommand => ({
        kind: "connect",
        target: entry,
        from: port(s, "ALIGN@1", "out"),
        to: port(s, "COUNT@1", "aligned"),
      }),
      (s: EditStateOf): EditCommand => ({
        kind: "deleteNode",
        target: entry,
        node: node(s, ".view@1").id,
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
  "f111-start-legacy -> f111-edits-legacy": {
    start: "f111-start-legacy",
    expected: "f111-edits-legacy",
    steps: [
      (s: EditStateOf): EditCommand => ({
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
    it(`F-111 step 2 ADR-0011: the scripted edits on ${g.start} produce tools/oracle/cases/${g.expected} byte for byte (${name})`, async () => {
      const result = await run(g.start, g.steps);
      for (const [path, text] of Object.entries(result))
        await expect(text).toMatchFileSnapshot(join(cases, g.expected, path));
      // no files beyond the result
      expect(files(join(cases, g.expected))).toEqual(
        Object.keys(result).sort(),
      );
    });
});
