import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IncludeRules, SourceParser } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { installedPacks, installedPackVersions } from "../../src/packs";
import { loadParser } from "../../src/source/parser";
import { modelAll } from "./describe";
import { readTree } from "./read-tree";

let parser: SourceParser;
let rules: IncludeRules;
beforeAll(async () => {
  const version = installedPackVersions()[0] as string;
  parser = await loadParser(version);
  rules = (
    installedPacks.find((p) => p.version === version) as {
      includes: IncludeRules;
    }
  ).includes;
});

const fixtures = fileURLToPath(
  new URL("../../../lang-2610/test/ast/fixtures", import.meta.url),
);
const corpusFixtures = (name: string) =>
  fileURLToPath(
    new URL(`../../../../tools/corpus/fixtures/${name}`, import.meta.url),
  );
const files = (...f: [string, string][]) =>
  f.map(([path, text]) => ({ path, text }));

describe("per-file model", () => {
  it("F-105 step 1 AR-03: includes resolve to files and entries to declarations, under their aliases", () => {
    const models = modelAll(readTree(fixtures), parser, rules);

    const alias = models.get("include-alias.nf");
    const inc = alias?.includes[0];
    expect(inc?.kind).toBe("script");
    if (inc?.kind !== "script") throw new Error("not a script include");
    expect(inc.target).toEqual({
      kind: "file",
      path: "some/module.nf",
      module: null,
    });
    expect(inc.entries[0]?.entry.alias?.name).toBe("sayHello");
    expect(inc.entries[0]?.declaration).toMatchObject({
      kind: "Function",
      name: { name: "hello" },
    });
    expect(alias?.diagnostics).toEqual([]);

    const registry = models.get("include-registry.nf");
    const reg = registry?.includes[0];
    if (reg?.kind !== "script") throw new Error("not a script include");
    expect(reg.target).toEqual({
      kind: "file",
      path: "modules/nf-core/fastqc/main.nf",
      module: "nf-core/fastqc",
    });
    expect(reg.entries[0]?.declaration).toMatchObject({
      kind: "Process",
      name: { name: "FASTQC" },
    });
    expect(registry?.diagnostics).toEqual([]);

    const pipeline = models.get("include-pipeline.nf");
    const pi = pipeline?.includes[0];
    if (pi?.kind !== "script") throw new Error("not a script include");
    expect(pi.target).toMatchObject({
      kind: "file",
      path: "pipelines/rnaseq.nf",
    });
    expect(pi.entries.map((e) => [e.declaration?.kind, e.pipeline])).toEqual([
      ["ParamsBlock", true],
      ["Workflow", true],
    ]);
    expect(pipeline?.diagnostics).toEqual([]);
  });

  it("F-105 AR-03: lookup finds local declarations, then include entries by alias; plugin entries bind without a declaration; pipeline names aren't in scope", () => {
    const models = modelAll(
      files(
        [
          "main.nf",
          `include { hello ; bye as goodbye } from './lib'
include { samplesheetToList } from 'plugin/nf-schema'
include { workflow as PIPE } from './pipe.nf'
include { hello as LOCAL } from './lib'

process LOCAL {
    script:
    'x'
}

workflow {
    LOCAL()
}
`,
        ],
        [
          "lib.nf",
          "def hello() {\n    'hello'\n}\n\ndef bye() {\n    'bye'\n}\n",
        ],
        ["pipe.nf", "workflow {\n    println 'x'\n}\n"],
      ),
      parser,
      rules,
    );
    const scope = models.get("main.nf")?.scope;
    expect([...(scope?.keys() ?? [])]).toEqual([
      "LOCAL",
      "hello",
      "goodbye",
      "samplesheetToList",
      "PIPE",
    ]);
    expect(scope?.get("LOCAL")).toMatchObject({
      kind: "declaration",
      declaration: { kind: "Process" },
    });
    expect(scope?.get("goodbye")).toMatchObject({
      kind: "include",
      entry: { declaration: { kind: "Function", name: { name: "bye" } } },
    });
    expect(scope?.get("samplesheetToList")).toMatchObject({
      kind: "include",
      entry: { declaration: null },
    });
    expect(scope?.get("PIPE")).toMatchObject({
      kind: "include",
      entry: { pipeline: true },
    });
    expect(scope?.has("workflow")).toBe(false);
    expect(models.get("main.nf")?.diagnostics).toEqual([]);
  });

  it('F-105 step 1 ADR-0004: a target the grammar rejects gives "Module could not be parsed" but still binds what it can; builder-only errors don\'t', () => {
    const flag = readFileSync(corpusFixtures("typed-without-flag.nf"), "utf8");
    const models = modelAll(
      files(
        [
          "main.nf",
          `include { OK ; MISSING } from './q'
include { HELLO ; GOODBYE } from './typed-without-flag'
include { NOPE } from './typed-without-flag'
`,
        ],
        ["q.nf", "process OK {\n    script:\n    'x'\n}\n\nprocess Q {\n"],
        ["typed-without-flag.nf", flag],
      ),
      parser,
      rules,
    );
    const main = models.get("main.nf");
    expect(
      main?.diagnostics.map((d) => [d.code, d.range.line, d.range.column]),
    ).toEqual([
      ["include-not-parsed", 1, 1],
      ["include-name", 3, 1],
    ]);
    expect(main?.diagnostics[0]?.message).toBe(
      "Module could not be parsed: 'q.nf'",
    );
    expect(main?.diagnostics[1]?.message).toBe(
      "Included name 'NOPE' is not defined in module 'typed-without-flag.nf'",
    );
    const first = main?.includes[0];
    if (first?.kind !== "script") throw new Error("not a script include");
    expect(first.entries.map((e) => e.declaration?.kind ?? null)).toEqual([
      "Process",
      null,
    ]);
    const second = main?.includes[1];
    if (second?.kind !== "script") throw new Error("not a script include");
    // HELLO has a builder error, so it is unparsed, but it still binds by its head
    expect(second.entries.map((e) => e.declaration?.kind)).toEqual([
      "Unparsed",
      "Process",
    ]);
  });

  it("F-105 step 1 AR-03 FI-05: missing targets give diagnostics naming the path, in a script and in a config", () => {
    const models = modelAll(
      files(
        [
          "main.nf",
          "include { A } from './nope'\ninclude { B } from 'nf-core/x'\ninclude { C } from 'plugin/p'\n",
        ],
        [
          "nextflow.config",
          "includeConfig 'conf/missing.config'\nprofiles {\n    test { includeConfig 'conf/ok.config' }\n}\nincludeConfig \"${params.x}.config\"\n",
        ],
        ["conf/ok.config", "process.cpus = 1\n"],
      ),
      parser,
      rules,
    );
    expect(
      models
        .get("main.nf")
        ?.diagnostics.map((d) => [d.code, d.severity, d.path, d.message]),
    ).toEqual([
      [
        "include-target",
        "error",
        "main.nf",
        "Invalid include source: 'nope.nf'",
      ],
      [
        "include-target",
        "error",
        "main.nf",
        "Module 'nf-core/x' is not in the project: 'modules/nf-core/x/main.nf' does not exist",
      ],
    ]);
    const config = models.get("nextflow.config");
    expect(
      config?.diagnostics.map((d) => [
        d.code,
        d.range.line,
        d.range.column,
        d.message,
      ]),
    ).toEqual([
      ["include-target", 1, 1, "Invalid include source: 'conf/missing.config'"],
    ]);
    expect(config?.includes.map((i) => i.target.kind)).toEqual([
      "missing",
      "file",
      "external",
    ]);
  });

  it("F-105 IO-14: modelling never throws on verbatim, plain and self-including files", () => {
    const models = modelAll(
      files(
        [
          "a.nf",
          "include { X } from './a'\nprocess X {\n    script:\n    'x'\n}\n",
        ],
        ["b.nf", "include { Y } from './c'\n"],
        ["c.nf", "include { Z } from './b'\n"],
        ["broken.nf", "\u0000 {{{ include"],
        ["README.md", "# hi\n"],
      ),
      parser,
      rules,
    );
    expect(models.size).toBe(5);
    expect(models.get("a.nf")?.diagnostics).toEqual([]);
    expect(models.get("README.md")?.includes).toEqual([]);
    expect(models.get("b.nf")?.diagnostics.map((d) => d.code)).toEqual([
      "include-name",
    ]);
  });
});
