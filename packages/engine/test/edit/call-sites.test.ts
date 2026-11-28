import type {
  ScriptSourceFile,
  TypedProcess,
  TypedProcessForm,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import type { EditState } from "../../src/edit/apply";
import { processCalls } from "../../src/edit/call-sites";
import { processForm } from "../../src/form/read-process";
import { accepted, commit, refused, stateFor } from "./helpers";

const GREET =
  "nextflow.enable.types = true\n\nprocess GREET {\n    input:\n    a: String\n    b: String\n\n    script:\n    'x'\n}\n";
const files = {
  "g.nf": GREET,
  "main.nf":
    "nextflow.enable.types = true\n\ninclude { GREET } from './g.nf'\ninclude { GREET as HI } from './g.nf'\ninclude { SUB } from './sub.nf'\n\nworkflow {\n    GREET('a', 'b')\n    x = HI('c', 'd')\n    SUB()\n}\n",
  "sub.nf":
    "nextflow.enable.types = true\n\ninclude { GREET } from './g.nf'\n\nworkflow SUB {\n    main:\n    GREET('e', 'f')\n}\n",
};

const formOf = (state: EditState): TypedProcessForm => {
  const model = state.model.file("g.nf");
  return processForm(
    model?.source as ScriptSourceFile,
    model?.declarations.get("GREET")?.declaration as TypedProcess,
    state.catalogue,
  );
};

const run = (state: EditState, form: TypedProcessForm) =>
  accepted(state, {
    kind: "updateDeclaration",
    path: "g.nf",
    name: "GREET",
    form,
  });

const out = (r: { files: readonly { path: string; text: string | null }[] }) =>
  Object.fromEntries(r.files.map((f) => [f.path, f.text]));

describe("F-303 call sites", () => {
  it("F-303 ADR-0039 LA-33: processCalls finds every call, including aliased includes", async () => {
    const state = await stateFor(files);
    const calls = processCalls(state.model, "g.nf", "GREET");
    expect(calls.map((c) => `${c.path}:${c.localName}`).sort()).toEqual([
      "main.nf:GREET",
      "main.nf:HI",
      "sub.nf:GREET",
    ]);
  });

  it("F-303 ADR-0039 LA-33: new inputs append null, removed ones drop their argument, a reorder permutes arguments, at every call including aliased includes", async () => {
    const state = await stateFor(files);
    const form = formOf(state);
    const added = out(
      run(state, {
        ...form,
        inputs: [
          ...form.inputs,
          {
            origin: null,
            kind: "named",
            name: "c",
            type: "String",
            nullable: true,
          },
        ],
      }),
    );
    expect(added["main.nf"]).toContain("GREET('a', 'b', null)");
    expect(added["main.nf"]).toContain("HI('c', 'd', null)");
    expect(added["sub.nf"]).toContain("GREET('e', 'f', null)");

    const removed = out(run(state, { ...form, inputs: form.inputs.slice(1) }));
    expect(removed["main.nf"]).toContain("GREET('b')");
    expect(removed["main.nf"]).toContain("HI('d')");
    expect(removed["sub.nf"]).toContain("GREET('f')");

    const swapped = run(state, { ...form, inputs: [...form.inputs].reverse() });
    expect(out(swapped)["main.nf"]).toContain("GREET('b', 'a')");
    expect(out(swapped)["main.nf"]).toContain("HI('d', 'c')");
    commit(state, swapped);
    expect(state.model.diagnostics()).toEqual([]);
  });

  it("F-303: a call fed by a pipe refuses an input change", async () => {
    const state = await stateFor({
      ...files,
      "main.nf":
        "nextflow.enable.types = true\n\ninclude { GREET } from './g.nf'\n\nworkflow {\n    channel.of('a') | GREET\n}\n",
    });
    const form = formOf(state);
    const r = refused(state, {
      kind: "updateDeclaration",
      path: "g.nf",
      name: "GREET",
      form: { ...form, inputs: form.inputs.slice(1) },
    });
    expect(r.message).toBe(
      "GREET is called with a pipe in main.nf; change its inputs in the Code tab. Nothing was changed.",
    );
    // a change that leaves the inputs alone is fine
    expect(
      run(state, { ...form, description: "Hi." }).patches.map((p) => p.path),
    ).toEqual(["g.nf"]);
  });
});
