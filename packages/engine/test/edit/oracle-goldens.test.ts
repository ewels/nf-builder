import { join } from "node:path";
import type {
  EditCommand,
  ScriptSourceFile,
  TypedProcess,
  TypedProcessForm,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import type { EditState } from "../../src/edit/apply";
import { processForm } from "../../src/form/read-process";
import { readTree } from "../model/read-tree";
import { accepted, commit, node, port, stateFor, texts } from "./helpers";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;

const entry = { path: "main.nf", workflow: null };

/** Runs `steps` one by one, each built from the projection of the state after the one before. */
async function run(
  start: string | Record<string, string>,
  steps: ((state: EditState) => EditCommand)[],
): Promise<Record<string, string>> {
  const state = await stateFor(
    typeof start === "string"
      ? Object.fromEntries(
          readTree(join(cases, start)).map((f) => [f.path, f.text]),
        )
      : start,
  );
  for (const step of steps) commit(state, accepted(state, step(state)));
  expect(state.model.diagnostics()).toEqual([]);
  return texts(state);
}

/** An `updateDeclaration` of `name` in `path` built from its current form. */
const update =
  (
    path: string,
    name: string,
    change: (form: TypedProcessForm) => TypedProcessForm,
  ) =>
  (s: EditState): EditCommand => {
    const file = s.model.file(path);
    return {
      kind: "updateDeclaration",
      path,
      name,
      form: change(
        processForm(
          file?.source as ScriptSourceFile,
          file?.declarations.get(name)?.declaration as TypedProcess,
          s.catalogue,
        ),
      ),
    };
  };

const PAIR_MODULE = "modules/local/split/main.nf";
const OUTPUTS_START = {
  "main.nf": `nextflow.enable.types = true

include { SPLIT } from './modules/local/split/main.nf'

workflow {
    parts = SPLIT('hello')
    parts.first.view()
    parts.second.view()
}
`,
  [PAIR_MODULE]: `nextflow.enable.types = true

process SPLIT {
    input:
    word: String

    output:
    first: Path = file('first.txt')
    second: Path = file('second.txt')

    script:
    """
    echo \${word} > first.txt
    echo \${word} > second.txt
    """

    stub:
    """
    touch first.txt second.txt
    """
}
`,
};

const JOIN = "modules/local/join/main.nf";
const ALL_START = {
  "main.nf": `nextflow.enable.types = true

include { JOIN } from './modules/local/join/main.nf'
include { PAIR } from './subworkflows/local/pair/main.nf'

workflow {
    joined = JOIN('hello', 'world', record(tag: 'T'))
    joined.view()
    PAIR()
}
`,
  "subworkflows/local/pair/main.nf": `nextflow.enable.types = true

include { JOIN } from '../../../modules/local/join/main.nf'

workflow PAIR {
    main:
    pair = JOIN('a', 'b', record(tag: 'P'))
    pair.view()
}
`,
  [JOIN]: `nextflow.enable.types = true

/**
 * Joins two words.
 *
 * @param left the first word
 */
process JOIN {
    storeDir 'cache'
    cpus 1

    input:
    left: String
    right: String
    record(tag: String)

    stage:
    env 'WORDS', left

    output:
    text: Path = file('joined.txt')

    topic:
    eval('tool --version') >> 'versions'

    script:
    """
    echo \${left} \${right} \${tag} > joined.txt
    """

    stub:
    """
    touch joined.txt
    """
}
`,
};

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
  "f303-configure-start -> f303-configure-typed": {
    start: "f303-configure-start",
    expected: "f303-configure-typed",
    steps: [
      update("modules/local/greet/main.nf", "GREET", (form) => ({
        ...form,
        inputs: [
          ...form.inputs,
          {
            origin: null,
            kind: "named",
            name: "punctuation",
            type: "String",
            nullable: true,
          },
        ],
        outputs: form.outputs.map((o) => ({ ...o, name: "message" })),
        directives: [
          ...form.directives,
          {
            origin: null,
            kind: "named",
            name: "cpus",
            args: "1",
            deprecated: false,
            known: true,
          },
        ],
      })),
    ],
  },
  // F-303 point 5: the rename and the move of its folder, as the popup applies them
  "f303-configure-start -> f303-rename-moved": {
    start: "f303-configure-start",
    expected: "f303-rename-moved",
    steps: [
      (): EditCommand => ({
        kind: "renameDeclaration",
        path: "modules/local/greet/main.nf",
        name: "GREET",
        newName: "SAY",
      }),
      (): EditCommand => ({
        kind: "moveFile",
        path: "modules/local/greet",
        newPath: "modules/local/say",
      }),
    ],
  },
  // F-303 point 4: with two outputs the reads at the call sites follow the renames
  "f303 two outputs start -> f303-outputs-renamed": {
    start: OUTPUTS_START,
    expected: "f303-outputs-renamed",
    steps: [
      update(PAIR_MODULE, "SPLIT", (form) => ({
        ...form,
        outputs: form.outputs.map((o, i) => ({
          ...o,
          name: i === 0 ? "head" : "tail",
        })),
      })),
    ],
  },
  // every section edited once; a kept record(...) input and a kept storeDir; two callers; the stub removed, then added
  "f303 all-sections start -> f303-configure-all": {
    start: ALL_START,
    expected: "f303-configure-all",
    steps: [
      update(JOIN, "JOIN", (form) => ({
        ...form,
        description: "Joins two words with a tag.",
        directives: [
          ...form.directives.map((d) =>
            d.kind === "named" && d.name === "cpus" ? { ...d, args: "2" } : d,
          ),
          {
            origin: null,
            kind: "named",
            name: "time",
            args: "1.h",
            deprecated: false,
            known: true,
          },
        ],
        // right first, then left renamed to first; the record input stays last
        inputs: [
          form.inputs[1],
          form.inputs[0] && form.inputs[0].kind === "named"
            ? { ...form.inputs[0], name: "first" }
            : form.inputs[0],
          form.inputs[2],
        ].filter((r) => r !== undefined),
        stage: [
          ...form.stage,
          { origin: null, directive: "env", args: "'LABEL', right" },
        ],
        outputs: form.outputs.map((o) => ({ ...o, name: "joined" })),
        topics: form.topics.map((t) =>
          t.kind === "emit" ? { ...t, topic: "tool_versions" } : t,
        ),
        stub: null,
      })),
      update(JOIN, "JOIN", (form) => ({ ...form, stub: "'touch joined.txt'" })),
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
    it(`F-111 F-301 F-303 step 2 UX-41 step 3 ADR-0011: the scripted edits on ${typeof g.start === "string" ? g.start : "an inline tree"} produce tools/oracle/cases/${g.expected} byte for byte (${name})`, async () => {
      const result = await run(g.start, g.steps);
      for (const [path, text] of Object.entries(result))
        await expect(text).toMatchFileSnapshot(join(cases, g.expected, path));
      // no files beyond the result
      expect(readTree(join(cases, g.expected)).map((f) => f.path)).toEqual(
        Object.keys(result).sort(),
      );
    });
});
