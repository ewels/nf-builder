import { join } from "node:path";
import { EDIT_COMMAND_KINDS } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { loadLints } from "../../src/diagnostics/lints";
import { applyCommand, createEditState } from "../../src/edit/apply";
import { connectionTargets } from "../../src/edit/connection-targets";
import { createProjector } from "../../src/projection/project";
import { readTree } from "../model/read-tree";
import { assertSequences, Stats, sequenceArb } from "./harness";
import { version } from "./helpers";

const root = new URL("../../../../", import.meta.url).pathname;
const oracle = (name: string) => join(root, "tools/oracle/cases", name);
const runs = Number(process.env.F111_RUNS ?? 25);

const crlf = (text: string) => text.replace(/\n/g, "\r\n");
const crlfFiles = {
  "main.nf": crlf(
    'process A {\n    input:\n    val x\n\n    output:\n    val y\n\n    script:\n    """\n    echo $x\n      echo done\n    """\n}\n\nworkflow {\n    msg = """\n      one\n        two\n      """\n    A(msg)\n    println(msg)\n}\n',
  ),
};

const trees: {
  name: string;
  dir?: string;
  files?: Record<string, string>;
  start?: true;
}[] = [
  { name: "a CRLF script with multi-line strings", files: crlfFiles },
  { name: "f111-start-typed", dir: oracle("f111-start-typed"), start: true },
  { name: "f111-start-legacy", dir: oracle("f111-start-legacy"), start: true },
  {
    name: "projection fixtures",
    dir: join(root, "packages/engine/test/projection/fixtures"),
  },
  ...[
    "s1-legacy-calls-typed",
    "s1-legacy-calls-typed-module",
    "s1-mixed-types-off",
    "s1-mixed-types-on",
    "s1-typed-calls-legacy",
    "s1-typed-calls-legacy-module",
    "s1-typed-legacy-tuple-arity",
    "s1-typed-list-literal-tuple",
  ].map((name) => ({ name, dir: oracle(name) })),
  { name: "corpus fixtures", dir: join(root, "tools/corpus/fixtures") },
  {
    name: "lang-2610 AST fixtures",
    dir: join(root, "packages/lang-2610/test/ast/fixtures"),
  },
];

const startStats = new Stats();

describe("F-111 properties", () => {
  for (const tree of trees)
    it(`F-111 step 1 AR-22 AR-23 AR-24 LA-13: random command sequences on ${tree.name} parse, keep untargeted declarations equivalent and undo to exact bytes`, async () => {
      const files = tree.dir
        ? readTree(tree.dir)
        : Object.entries(tree.files ?? {}).map(([path, text]) => ({
            path,
            text,
          }));
      const state = await createEditState(version, files);
      assertSequences(
        state,
        sequenceArb,
        tree.start ? startStats : new Stats(),
        runs,
      );
    }, 180_000);

  it("F-111 step 1: every command kind is accepted at least once on the start trees", () => {
    for (const kind of EDIT_COMMAND_KINDS)
      expect(
        startStats.accepted.get(kind) ?? 0,
        `${kind} accepted`,
      ).toBeGreaterThan(0);
  });

  it("F-302 UX-25: a target the dry run marks refused is refused by apply; one apply accepts is never marked refused", async () => {
    const lints = await loadLints(version);
    const target = { path: "main.nf", workflow: null };
    let refused = 0;
    let accepted = 0;
    for (const name of [
      "f111-start-typed",
      "f111-start-legacy",
      "f302-connect-start",
    ]) {
      const state = await createEditState(version, readTree(oracle(name)));
      const projection = createProjector(state.model, state.catalogue).project(
        "main.nf",
        null,
      );
      for (const from of projection?.nodes ?? [])
        for (const out of from.outputs) {
          const ref = { node: from.id, port: out.id };
          for (const t of connectionTargets(state, lints, target, ref)) {
            const result = applyCommand(state, {
              kind: "connect",
              target,
              from: ref,
              to: { node: t.node, port: t.port },
            });
            if (t.status === "refused") {
              refused++;
              expect(result.ok, `${name} ${from.id} -> ${t.node}`).toBe(false);
            } else {
              // both directions: a target the dry run lets through is accepted (apart from a reprint failure)
              if (!result.ok)
                expect(result.code, `${name} ${from.id} -> ${t.node}`).toBe(
                  "internal",
                );
              else accepted++;
            }
          }
        }
    }
    expect(refused).toBeGreaterThan(0);
    expect(accepted).toBeGreaterThan(0);
  });
});
