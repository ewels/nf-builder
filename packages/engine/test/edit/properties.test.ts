import { join } from "node:path";
import { EDIT_COMMAND_KINDS } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { createEditState } from "../../src/edit/apply";
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
});
