import { join } from "node:path";
import type {
  EditCommand,
  ScriptSourceFile,
  TypedProcess,
  TypedProcessForm,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { applyCommand, type EditState } from "../../src/edit/apply";
import { applyPatches } from "../../src/edit/patches";
import { processForm } from "../../src/form/read-process";
import { readTree } from "../model/read-tree";
import { snapshot } from "./harness";
import { accepted, commit, refused, stateFor } from "./helpers";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
const MODULE = "modules/local/greet/main.nf";

const startState = () =>
  stateFor(
    Object.fromEntries(
      readTree(join(cases, "f303-configure-start")).map((f) => [
        f.path,
        f.text,
      ]),
    ),
  );

const formOf = (
  state: EditState,
  path: string,
  name: string,
): TypedProcessForm => {
  const model = state.model.file(path);
  return processForm(
    model?.source as ScriptSourceFile,
    model?.declarations.get(name)?.declaration as TypedProcess,
    state.catalogue,
  );
};

const update = (
  path: string,
  name: string,
  form: TypedProcessForm,
): EditCommand => ({ kind: "updateDeclaration", path, name, form });

describe("F-303 UpdateDeclaration", () => {
  it("F-303 step 2 UX-44 AR-21: adding an input, renaming an output and adding cpus is one updateDeclaration whose module equals f303-configure-typed", async () => {
    const state = await startState();
    const form = formOf(state, MODULE, "GREET");
    const next: TypedProcessForm = {
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
    };
    const r = accepted(state, update(MODULE, "GREET", next));
    expect(r.patches.map((p) => p.path).sort()).toEqual(["main.nf", MODULE]);
    const expected = Object.fromEntries(
      readTree(join(cases, "f303-configure-typed")).map((f) => [
        f.path,
        f.text,
      ]),
    );
    for (const file of r.files) expect(file.text).toBe(expected[file.path]);
    commit(state, r);
    expect(state.model.diagnostics()).toEqual([]);
  });

  it("F-303 AR-22 LA-45: an unchanged form changes nothing; untouched rows keep their text and comments", async () => {
    const source = `nextflow.enable.types = true

/**
 * Aligns reads.
 */
process P {
    cpus 2 // two
    // about storeDir
    memory { 1.GB }

    input:
    // the reads
    reads: Path

    output:
    bam: Path = file('a.bam')

    script:
    """
    echo hi
    """
}
`;
    const state = await stateFor({ "p.nf": source });
    const form = formOf(state, "p.nf", "P");
    const same = accepted(state, update("p.nf", "P", form));
    expect(same.patches).toEqual([]);
    const next: TypedProcessForm = {
      ...form,
      directives: form.directives.map((d, i) =>
        i === 0 && d.kind === "named" ? { ...d, args: "4" } : d,
      ),
    };
    const r = accepted(state, update("p.nf", "P", next));
    expect(r.files[0]?.text).toBe(
      source.replace("cpus 2 // two", "cpus 4 // two"),
    );
  });

  it("F-303 AR-24 UX-44: a value that doesn't parse is refused with a field problem on that row and no patch", async () => {
    const state = await startState();
    const form = formOf(state, MODULE, "GREET");
    const r = refused(
      state,
      update(MODULE, "GREET", {
        ...form,
        outputs: form.outputs.map((o) => ({ ...o, value: "file(" })),
      }),
    );
    expect(r.fields?.[0]?.field).toEqual({
      section: "outputs",
      row: 0,
      part: "value",
    });
    expect(r.fields?.[0]?.message.length).toBeGreaterThan(0);
    expect(r.message).toMatch(/Nothing was changed/);
  });

  it("F-303 AR-24 UX-44: empty required values and duplicate names are field problems", async () => {
    const state = await startState();
    const form = formOf(state, MODULE, "GREET");
    const input = (name: string, type = "String") =>
      ({ origin: null, kind: "named", name, type, nullable: false }) as const;
    const fieldOf = (f: TypedProcessForm) =>
      refused(state, update(MODULE, "GREET", f)).fields?.[0]?.field;
    expect(
      fieldOf({ ...form, inputs: [...form.inputs, input("name")] }),
    ).toEqual({
      section: "inputs",
      row: 1,
      part: "name",
    });
    expect(
      fieldOf({ ...form, inputs: [...form.inputs, input("x", "")] }),
    ).toEqual({
      section: "inputs",
      row: 1,
      part: "type",
    });
    expect(fieldOf({ ...form, inputs: [...form.inputs, input("1x")] })).toEqual(
      {
        section: "inputs",
        row: 1,
        part: "name",
      },
    );
    expect(
      fieldOf({
        ...form,
        directives: [
          {
            origin: null,
            kind: "named",
            name: "container",
            args: "",
            deprecated: false,
            known: true,
          },
        ],
      }),
    ).toEqual({ section: "directives", row: 0, part: "args" });
    expect(fieldOf({ ...form, script: { ...form.script, text: " " } })).toEqual(
      {
        section: "script",
        row: null,
        part: "text",
      },
    );
  });

  it("F-303 UX-41: editing the description keeps the doc tags; an empty description with no tags removes the comment", async () => {
    const source =
      "nextflow.enable.types = true\n\n/**\n * Old.\n *\n * @param x the x\n */\nprocess P {\n    input:\n    x: String\n\n    script:\n    'p'\n}\n\n/** Only text. */\nprocess Q {\n    script:\n    'q'\n}\n";
    const state = await stateFor({ "p.nf": source });
    const p = formOf(state, "p.nf", "P");
    const r = accepted(
      state,
      update("p.nf", "P", { ...p, description: "New text." }),
    );
    expect(r.files[0]?.text).toContain(
      "/**\n * New text.\n *\n * @param x the x\n */\nprocess P",
    );
    const q = formOf(state, "p.nf", "Q");
    expect(q.description).toBe("Only text.");
    const gone = accepted(
      state,
      update("p.nf", "Q", { ...q, description: "" }),
    );
    expect(gone.files[0]?.text).toBe(source.replace("/** Only text. */\n", ""));
    const added = accepted(
      state,
      update("p.nf", "Q", { ...q, description: "Fresh." }),
    );
    expect(added.files[0]?.text).toContain("/**\n * Fresh.\n */\nprocess Q");
  });

  it("F-303 UX-41: a stub is added and removed, and the script changes", async () => {
    const state = await startState();
    const form = formOf(state, MODULE, "GREET");
    const removed = accepted(
      state,
      update(MODULE, "GREET", { ...form, stub: null }),
    );
    expect(removed.files[0]?.text).not.toContain("stub:");
    commit(state, removed);
    const again = formOf(state, MODULE, "GREET");
    expect(again.stub).toBeNull();
    const added = accepted(
      state,
      update(MODULE, "GREET", {
        ...again,
        script: { ...again.script, text: "'echo hi'" },
        stub: "'touch x'",
      }),
    );
    const text = added.files[0]?.text ?? "";
    expect(text).toContain("script:\n    'echo hi'");
    expect(text).toContain("stub:\n    'touch x'");
  });

  it("F-303 AR-23: updateDeclaration's inverse restores the exact bytes of every file it touched", async () => {
    const state = await startState();
    const before = snapshot(state);
    const form = formOf(state, MODULE, "GREET");
    const r = accepted(
      state,
      update(MODULE, "GREET", {
        ...form,
        description: "Changed.",
        inputs: [],
        stub: null,
      }),
    );
    const after = applyPatches(before, r.patches).files;
    expect(after).not.toEqual(before);
    expect(applyPatches(after, r.inverse).files).toEqual(before);
  });

  it("F-303 LA-13: a legacy process or an Unparsed declaration is refused with a message", async () => {
    const state = await stateFor({
      "l.nf": "process L {\n    input:\n    val x\n\n    script:\n    'l'\n}\n",
      "u.nf":
        "nextflow.enable.types = true\n\nprocess U {\n    input:\n    x: \n}\n",
    });
    const form = formOf(await startState(), MODULE, "GREET");
    for (const [path, name, code] of [
      ["l.nf", "L", "invalid"],
      ["u.nf", "U", "invalid"],
      ["l.nf", "NOPE", "not-found"],
      ["none.nf", "L", "not-found"],
    ] as const) {
      const r = applyCommand(state, update(path, name, form));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(code);
        expect(r.message.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("F-303 input renames", () => {
  it("F-303 UX-41: renaming an input renames its uses in the rows the user didn't edit", async () => {
    const source =
      'nextflow.enable.types = true\n\nprocess P {\n    cpus 1\n\n    input:\n    name: String\n\n    stage:\n    env \'WHO\', name\n\n    output:\n    text: Path = file("${name}.txt")\n\n    script:\n    """\n    echo ${name} > ${name}.txt\n    """\n\n    stub:\n    """\n    touch ${name}.txt\n    """\n}\n';
    const state = await stateFor({ "p.nf": source });
    const form = formOf(state, "p.nf", "P");
    const r = accepted(
      state,
      update("p.nf", "P", {
        ...form,
        inputs: form.inputs.map((i) =>
          i.kind === "named" ? { ...i, name: "who" } : i,
        ),
      }),
    );
    expect(r.files[0]?.text).toBe(source.replaceAll("name", "who"));
    // a row the user edits in the same step is theirs: it isn't touched
    const edited = accepted(
      state,
      update("p.nf", "P", {
        ...form,
        inputs: form.inputs.map((i) =>
          i.kind === "named" ? { ...i, name: "who" } : i,
        ),
        stage: form.stage.map((s) => ({ ...s, args: "'x', name" })),
      }),
    );
    expect(edited.files[0]?.text).toContain("env 'x', name");
    expect(edited.files[0]?.text).toContain("echo ${who} > ${who}.txt");
  });

  it("F-303 UX-41: a closure parameter or local that shadows the renamed input is left alone", async () => {
    const source =
      'nextflow.enable.types = true\n\nprocess P {\n    input:\n    name: String\n    names: Bag<String>\n\n    output:\n    text: String = names.collect { name -> name.toUpperCase() }.join(name)\n\n    script:\n    """\n    echo hi\n    """\n}\n';
    const state = await stateFor({ "p.nf": source });
    const form = formOf(state, "p.nf", "P");
    const r = accepted(
      state,
      update("p.nf", "P", {
        ...form,
        inputs: form.inputs.map((i) =>
          i.kind === "named" && i.name === "name" ? { ...i, name: "who" } : i,
        ),
      }),
    );
    expect(r.files[0]?.text).toContain(
      "names.collect { name -> name.toUpperCase() }.join(who)",
    );
  });
});
