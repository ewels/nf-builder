import { join } from "node:path";
import type { EditCommand } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import type { EditState } from "../../src/edit/apply";
import { diagnoseFiles } from "../diagnostics/open";
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
  return runFiles(
    Object.fromEntries(
      readTree(join(cases, start)).map((f) => [f.path, f.text]),
    ),
    steps,
  );
}

async function runFiles(
  files: Record<string, string>,
  steps: ((state: EditState) => EditCommand)[],
): Promise<Record<string, string>> {
  const state = await stateFor(files);
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

/** The text of every file of a state, and the diagnoser's errors for it. */
async function errorsOf(files: Record<string, string>) {
  const { diagnoser } = await diagnoseFiles(
    Object.entries(files).map(([path, text]) => ({ path, text })),
  );
  return diagnoser.all().filter((d) => d.severity === "error");
}
const tree = (name: string) =>
  Object.fromEntries(readTree(join(cases, name)).map((f) => [f.path, f.text]));
const connectInto = (from: [string, string]) => (s: EditState) =>
  ({
    kind: "connect",
    target: entry,
    from: port(s, ...from),
    to: port(s, "DESCRIBE@1", "sample"),
  }) as EditCommand;

describe("F-302 oracle goldens", () => {
  it("F-302 step 1 UX-25: Connect params.input to DESCRIBE.sample on f302-connect-start equals f302-connect-typed, with no diagnostics", async () => {
    const result = await run("f302-connect-start", [
      connectInto([":params", "input"]),
    ]);
    expect(result).toEqual(tree("f302-connect-typed"));
    expect(await errorsOf(result)).toEqual([]);
  });

  it("F-302 step 2 LA-32: Connect TOUCH's output to DESCRIBE.sample equals f302-connect-mismatch, with one type-mismatch error at the argument", async () => {
    const result = await run("f302-connect-start", [
      connectInto(["TOUCH@1", "out"]),
    ]);
    expect(result).toEqual(tree("f302-connect-mismatch"));
    const errors = await errorsOf(result);
    expect(errors.map((d) => d.code)).toEqual(["type-mismatch"]);
    const [only] = errors;
    expect(only?.path).toBe("main.nf");
    expect(result["main.nf"]?.slice(only?.range.start, only?.range.end)).toBe(
      "touch",
    );
  });

  it("F-302 step 3: Disconnect DESCRIBE.sample on f302-connect-typed equals f302-connect-start byte for byte, parses, and has the call-arity error only", async () => {
    const result = await run("f302-connect-typed", [
      (s) => ({
        kind: "disconnect",
        target: entry,
        port: port(s, "DESCRIBE@1", "sample"),
      }),
    ]);
    expect(result).toEqual(tree("f302-connect-start"));
    expect((await errorsOf(result)).map((d) => d.code)).toEqual(["call-arity"]);
  });
});

const legacyStart = {
  "main.nf":
    "workflow ALIGN {\n    take:\n    reads\n\n    main:\n    reads.view()\n}\n\nworkflow {\n    reads = channel.of('a', 'b')\n    ALIGN(reads)\n}\n",
};

describe("F-307 oracle goldens", () => {
  const align = { path: "subworkflows/local/align/main.nf", workflow: "ALIGN" };
  const sort = { path: "subworkflows/local/sort/main.nf", workflow: "SORT" };
  const golden = async (expected: string, result: Record<string, string>) => {
    for (const [path, text] of Object.entries(result))
      await expect(text).toMatchFileSnapshot(join(cases, expected, path));
    expect(readTree(join(cases, expected)).map((f) => f.path)).toEqual(
      Object.keys(result).sort(),
    );
  };

  it("F-307 step 2 UX-51: f307-workflow-tabs plus AddTake equals oracle case f307-add-take", async () => {
    await golden(
      "f307-add-take",
      await run("f307-workflow-tabs", [
        (): EditCommand => ({
          kind: "addTake",
          target: align,
          name: "index",
          type: "Channel<String>",
        }),
      ]),
    );
  });

  it("F-307 step 2 UX-51: f307-workflow-tabs plus AddEmit equals oracle case f307-add-emit", async () => {
    await golden(
      "f307-add-emit",
      await run("f307-workflow-tabs", [
        (): EditCommand => ({
          kind: "addEmit",
          target: sort,
          name: "extra",
          type: "Channel<String>",
        }),
      ]),
    );
  });

  it("F-307 step 2 UX-51: a legacy workflow plus AddEmit equals oracle case f307-add-emit-legacy", async () => {
    await golden(
      "f307-add-emit-legacy",
      await runFiles(legacyStart, [
        (): EditCommand => ({
          kind: "addEmit",
          target: { path: "main.nf", workflow: "ALIGN" },
          name: "extra",
          type: null,
        }),
      ]),
    );
  });
});
