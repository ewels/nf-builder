import type { ScriptSourceFile, TypedProcess } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { createEditState } from "../../src/edit/apply";
import { formChoices, processForm } from "../../src/form/read-process";
import { installedPacks } from "../../src/packs";
import { version } from "../edit/helpers";

const ALL = `nextflow.enable.types = true

/**
 * Aligns reads.
 *
 * @param reads the reads
 */
process ALIGN {
    cpus 2
    // keep this
    storeDir 'cache'

    input:
    reads: Path
    index: String?
    record(a: String, b: Path)

    stage:
    env 'FOO', index

    output:
    bam: Path = file('out.bam')
    versions: String = eval('tool --version')

    topic:
    eval('tool --version') >> 'versions'
    reads >> 'tmp' + index

    when:
    true

    script:
    """
    align \${reads} > out.bam
    """

    stub:
    """
    touch out.bam
    """
}
`;

const load = async () => {
  const state = await createEditState(version, [
    { path: "main.nf", text: ALL },
  ]);
  const file = state.model.file("main.nf")?.source as ScriptSourceFile;
  const declaration = state.model.file("main.nf")?.declarations.get("ALIGN")
    ?.declaration as TypedProcess;
  return { state, file, declaration };
};

describe("F-303 read process", () => {
  it("F-303 UX-41: the form of a typed process lists name, description, inputs, stage, outputs, topics, directives, script and stub in source order", async () => {
    const { state, file, declaration } = await load();
    const form = processForm(file, declaration, state.catalogue);
    expect(form.name).toBe("ALIGN");
    expect(form.description).toBe("Aligns reads.");
    expect(form.docTags).toBe("@param reads the reads");
    expect(form.inputs.slice(0, 2)).toEqual([
      {
        origin: 0,
        kind: "named",
        name: "reads",
        type: "Path",
        nullable: false,
      },
      {
        origin: 1,
        kind: "named",
        name: "index",
        type: "String",
        nullable: true,
      },
    ]);
    expect(form.stage).toEqual([
      { origin: 0, directive: "env", args: "'FOO', index" },
    ]);
    expect(form.outputs).toEqual([
      { origin: 0, name: "bam", type: "Path", value: "file('out.bam')" },
      {
        origin: 1,
        name: "versions",
        type: "String",
        value: "eval('tool --version')",
      },
    ]);
    expect(form.directives[0]).toEqual({
      origin: 0,
      kind: "named",
      name: "cpus",
      args: "2",
      deprecated: false,
      known: true,
    });
    expect(form.script.label).toBe("script");
    expect(form.script.text).toBe('"""\nalign ${reads} > out.bam\n"""');
    expect(form.stub).toBe('"""\ntouch out.bam\n"""');
  });

  it("F-303 UX-41: record and tuple inputs, non-string topics and when: are kept as code rows or notes", async () => {
    const { state, file, declaration } = await load();
    const form = processForm(file, declaration, state.catalogue);
    expect(form.inputs[2]).toEqual({
      origin: 2,
      kind: "code",
      text: "record(a: String, b: Path)",
    });
    expect(form.topics).toEqual([
      {
        origin: 0,
        kind: "emit",
        value: "eval('tool --version')",
        topic: "versions",
      },
      { origin: 1, kind: "code", text: "reads >> 'tmp' + index" },
    ]);
    expect(form.directives.map((d) => d.kind)).toEqual(["named", "named"]);
    expect(form.directives[1]).toMatchObject({
      name: "storeDir",
      deprecated: true,
      known: true,
    });
    expect(form.kept).toEqual(["when: section"]);
  });

  it("F-303 step 3 UX-41 LA-34: directive choices are every non-deprecated catalogue directive; storeDir isn't one", async () => {
    const { state } = await load();
    const pack = installedPacks.find((p) => p.version === version);
    const rules = await pack?.loadConfigRules();
    if (!rules) throw new Error("no rules");
    const choices = formChoices(state.catalogue, rules);
    const expected = state.catalogue.directives
      .filter((d) => !d.deprecated)
      .map((d) => d.name)
      .sort();
    expect(choices.directives.map((d) => d.name)).toEqual(expected);
    expect(choices.directives.map((d) => d.name)).not.toContain("storeDir");
    expect(choices.stage.map((s) => s.name)).toEqual([
      "env",
      "stageAs",
      "stdin",
    ]);
    expect(choices.types).toContain("Duration");
    expect(choices.types).toContain("Path");
    expect(choices.types.some((t) => t.startsWith("shim."))).toBe(false);
  });

  it("F-303 UX-41: type suggestions include the documented standard types the generated catalogue lacks", async () => {
    const { state } = await load();
    const pack = installedPacks.find((p) => p.version === version);
    const rules = await pack?.loadConfigRules();
    if (!rules) throw new Error("no rules");
    const { types } = formChoices(
      state.catalogue,
      rules,
      [],
      pack?.standardTypes,
    );
    for (const name of ["Boolean", "Record", "Tuple"])
      expect(types).toContain(name);
    expect(types.filter((t) => t === "Boolean")).toHaveLength(1);
  });

  it("F-303 UX-41: the type suggestions include VersionNumber once", async () => {
    const { state } = await load();
    const pack = installedPacks.find((p) => p.version === version);
    const rules = await pack?.loadConfigRules();
    if (!rules) throw new Error("no rules");
    const { types } = formChoices(
      state.catalogue,
      rules,
      [],
      pack?.standardTypes,
    );
    expect(types.filter((t) => t === "VersionNumber")).toHaveLength(1);
  });

  it("F-303 UX-41: each directive choice's kind and default come from its catalogue type", async () => {
    const { state } = await load();
    const pack = installedPacks.find((p) => p.version === version);
    const rules = await pack?.loadConfigRules();
    if (!rules) throw new Error("no rules");
    const by = new Map(
      formChoices(state.catalogue, rules).directives.map((d) => [d.name, d]),
    );
    const of = (n: string) => [by.get(n)?.kind, by.get(n)?.defaultArgs];
    expect(of("cpus")).toEqual(["integer", "1"]);
    expect(of("memory")).toEqual(["memory", "1.GB"]);
    expect(of("time")).toEqual(["duration", "1.h"]);
    expect(of("debug")).toEqual(["boolean", "true"]);
    expect(of("container")).toEqual(["string", ""]);
  });
});
