import type { LintFinding, LintRule } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_ADVICE,
  deprecatedChannel,
  deprecatedDirective,
  deprecatedShell,
  deprecatedWhen,
  implicitIt,
} from "../../src/lints/deprecated.ts";
import {
  legacyParams,
  legacyProcess,
  legacyWorkflow,
  paramsOutsideEntry,
  publishDir,
  tupleWhereRecord,
} from "../../src/lints/legacy.ts";
import { catalogue, context } from "./context.ts";

const run = (rule: LintRule, text: string, language?: "script" | "config") =>
  rule.check(context(text, language));
const at = (text: string, findings: readonly LintFinding[]) =>
  findings.map((f) => text.slice(f.range.start, f.range.end));
// A minimal applier (a pack may not import the engine's applyTextEdits): edits are applied last to first.
const apply = (text: string, findings: readonly LintFinding[]) => {
  const unique = new Map(
    findings
      .flatMap((f) => f.fix?.edits ?? [])
      .map((e) => [`${e.start}:${e.end}:${e.text}`, e]),
  );
  let out = text;
  for (const e of [...unique.values()].sort((a, b) => b.start - a.start))
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
};

describe("F-112 LA-34 deprecations", () => {
  it("F-112 LA-34: implicit it resolves to the nearest paramless closure, not to declared parameters or a def it", () => {
    const text = [
      "workflow {",
      "    channel.of(1).map { it * 2 }",
      "    channel.of(1).map { x -> it }",
      "    channel.of(1).map { it -> it }",
      "    channel.of(1).map { -> it }",
      "    channel.of(1).map { def it = 3; it }",
      "    channel.of(1).map { x -> x.collect { it } }",
      '    channel.of(1).map { "${it}" }',
      "    println it",
      "}",
    ].join("\n");
    const found = run(implicitIt, text);
    expect(found.map((f) => f.range.line)).toEqual([2, 5, 7, 8]);
    expect(at(text, found)).toEqual(["it", "it", "it", "it"]);
    // the nested paramless closure owns its own it, so the one in line 7 is flagged, but not line 3 where the closure has a parameter
    expect(found.every((f) => f.fix !== undefined)).toBe(true);
    expect(apply(text, found).split("\n").slice(1, 2)).toEqual([
      "    channel.of(1).map { it -> it * 2 }",
    ]);
  });

  it("F-112 LA-34: the implicit it fix adds the parameter once per closure, before a bare arrow too", () => {
    const text =
      "workflow {\n    channel.of(1).map { -> it }.map { it + it }\n}";
    const fixed = apply(text, run(implicitIt, text));
    expect(fixed).toBe(
      "workflow {\n    channel.of(1).map { it -> it }.map { it -> it + it }\n}",
    );
  });

  it("F-112 LA-34: implicit it is flagged in configs as well", () => {
    const text = "process {\n    ext.args = { it.size() }\n}\n";
    expect(at(text, run(implicitIt, text, "config"))).toEqual(["it"]);
    expect(run(implicitIt, "process.cpus = 1\n", "config")).toEqual([]);
  });

  it("F-112 LA-34: Channel is flagged only as a method receiver", () => {
    const text = [
      "workflow {",
      "    Channel.of(1).view()",
      "    channel.of(1).view()",
      "    def x = Channel.empty()",
      "    def y: Channel<Path> = x",
      "}",
    ].join("\n");
    const found = run(deprecatedChannel, text);
    expect(found.map((f) => f.range.line)).toEqual([2, 4]);
    expect(apply(text, found)).toContain(
      "    channel.of(1).view()\n    channel.of(1).view()",
    );
    expect(apply(text, found)).toContain("def x = channel.empty()");
  });

  it("F-112 LA-34: when and shell are flagged at the section label with nf-lang's wording", () => {
    const text = [
      "process p {",
      "    when:",
      "    true",
      "",
      "    shell:",
      "    'echo'",
      "}",
    ].join("\n");
    const when = run(deprecatedWhen, text);
    expect(at(text, when)).toEqual(["when:"]);
    expect(when[0]?.message).toMatch(
      /^The `when` section is deprecated -- use /,
    );
    const shell = run(deprecatedShell, text);
    expect(at(text, shell)).toEqual(["shell:"]);
    expect(shell[0]?.message).toBe(
      "The `shell` block is deprecated, use `script` instead",
    );
  });

  it("F-112 LA-34: every directive the catalogue marks deprecated has advice", () => {
    const names = [
      ...catalogue.script.directives,
      ...catalogue.script.agentDirectives,
    ]
      .filter((d) => d.deprecated)
      .map((d) => d.name);
    expect(names).toContain("storeDir");
    for (const name of names)
      expect(DIRECTIVE_ADVICE[name], name).toBeDefined();
  });

  it("F-112 LA-34: a deprecated directive is flagged at the directive call, a current one is not", () => {
    const text =
      "process p {\n    storeDir 'cache'\n    cpus 1\n\n    script:\n    'x'\n}\n";
    const found = run(deprecatedDirective, text);
    expect(at(text, found)).toEqual(["storeDir 'cache'"]);
    expect(found[0]?.message).toMatch(
      /^The `storeDir` directive is deprecated -- use /,
    );
    expect(found[0]?.fix).toBeUndefined();
  });
});

describe("F-112 LA-35 LA-36 legacy patterns", () => {
  it("F-112 LA-35: legacy processes and workflows are suggestions at the name or keyword; typed ones are not", () => {
    const text = [
      "process p {",
      "    input:",
      "    val x",
      "    script:",
      "    'x'",
      "}",
      "workflow w {",
      "}",
      "workflow {",
      "}",
    ].join("\n");
    expect(at(text, run(legacyProcess, text))).toEqual(["p"]);
    expect(at(text, run(legacyWorkflow, text))).toEqual(["w", "workflow"]);
    const typed = `nextflow.enable.types = true\n\n${text.replace("val x", "x: String")}`;
    expect(run(legacyProcess, typed)).toEqual([]);
    expect(run(legacyWorkflow, typed)).toEqual([]);
  });

  it("F-112 LA-36: a legacy params assignment is flagged as a whole, a params block is not", () => {
    const text = "params.a = 1\nparams.b.c = 2\n";
    expect(at(text, run(legacyParams, text))).toEqual([
      "params.a = 1",
      "params.b.c = 2",
    ]);
    expect(
      run(
        legacyParams,
        "nextflow.enable.types = true\nparams {\n    a: Integer = 1\n}\n",
      ),
    ).toEqual([]);
  });

  it("F-112 LA-36: params is flagged in processes, functions and named workflows, not in the entry workflow or the output block", () => {
    const text = [
      "nextflow.enable.types = true",
      "params {",
      "    a: String = 'x'",
      "}",
      "process p {",
      "    cpus { params.cpus }",
      "    script:",
      '    "${params.a}"',
      "}",
      "def f() {",
      "    return params.a",
      "}",
      "workflow w {",
      "    main:",
      "    println params.a",
      "}",
      "def g(params) {",
      "    return params.a",
      "}",
      "workflow {",
      "    main:",
      "    println params.a",
      "    publish:",
      "    x = params.a",
      "}",
      "output {",
      "    x {",
      "        path params.a",
      "    }",
      "}",
    ].join("\n");
    const found = run(paramsOutsideEntry, text);
    expect(found.map((f) => f.range.line)).toEqual([6, 8, 11, 15]);
    expect(at(text, found)).toEqual(["params", "params", "params", "params"]);
  });

  it("F-112 LA-36: tuple inputs and tuple outputs of a typed process suggest a record; legacy processes are left alone", () => {
    const text = [
      "nextflow.enable.types = true",
      "process p {",
      "    input:",
      "    tuple(id: String, name: String)",
      "    output:",
      "    tuple(id, stdout())",
      "    script:",
      "    'x'",
      "}",
      "process q {",
      "    input:",
      "    a: String",
      "    output:",
      "    r: Tuple<String, String> = tuple(a, a)",
      "    script:",
      "    'x'",
      "}",
    ].join("\n");
    expect(at(text, run(tupleWhereRecord, text))).toEqual([
      "tuple(id: String, name: String)",
      "tuple(id, stdout())",
      "tuple(a, a)",
    ]);
    const legacy =
      "process p {\n    input:\n    tuple val(a), val(b)\n    output:\n    tuple val(a), val(b)\n    script:\n    'x'\n}\n";
    expect(run(tupleWhereRecord, legacy)).toEqual([]);
  });

  it("F-112 LA-36: a publishDir directive is flagged, an output block is not", () => {
    const text =
      "process p {\n    publishDir 'results', mode: 'copy'\n    script:\n    'x'\n}\n";
    expect(at(text, run(publishDir, text))).toEqual([
      "publishDir 'results', mode: 'copy'",
    ]);
    expect(
      run(publishDir, "process p {\n    cpus 1\n    script:\n    'x'\n}\n"),
    ).toEqual([]);
  });

  it("F-112 LA-34 LA-36: rules give nothing for a file without an AST", () => {
    const text = "process {{{";
    const ctx = context(text);
    for (const rule of [deprecatedWhen, legacyProcess, publishDir, implicitIt])
      expect(rule.check(ctx)).toEqual([]);
  });
});
