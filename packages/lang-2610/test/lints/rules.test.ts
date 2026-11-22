import type { LintFinding } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  callArity,
  declaredInputs,
  duplicateCall,
  nullArgument,
  unusedOutput,
} from "../../src/lints/calls.ts";
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
import { at, catalogue, context, run } from "./context.ts";

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
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Nextflow source, not a template
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

  it("F-112 LA-34: the implicit it fix is withheld when an enclosing scope already has it visible", () => {
    const nested =
      "workflow {\n    channel.of(1).map { it.collect { it * 2 } }\n}";
    const found = run(implicitIt, nested);
    expect(found.map((f) => f.fix !== undefined)).toEqual([true, false]);
    expect(at(nested, found)).toEqual(["it", "it"]);
    expect(apply(nested, found)).toBe(
      "workflow {\n    channel.of(1).map { it -> it.collect { it * 2 } }\n}",
    );
    const declared =
      "workflow {\n    channel.of(1).map { it -> it.collect { it * 2 } }\n}";
    const inner = run(implicitIt, declared);
    expect(inner).toHaveLength(1);
    expect(inner[0]?.fix).toBeUndefined();
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
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Nextflow source, not a template
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

describe("F-112 LA-33 calls", () => {
  const PROCESS = `process p {
    input:
    val x

    script:
    'echo'
}
`;

  it("F-112 LA-33: argument counts follow nf-lang: named arguments count once, closures count", () => {
    const text = `${PROCESS}
workflow {
    p(1, 2)
    p(a: 1)
    p(1, a: 2)
    p { it }
    p()
    p(1)
    x.p(1, 2)
    unknown(1, 2)
}
`;
    const found = run(callArity, text);
    expect(found.map((f) => f.message)).toEqual([
      "Incorrect number of call arguments, expected 1 but received 2 -- pass one argument for each input: `x`",
      "Incorrect number of call arguments, expected 1 but received 2 -- pass one argument for each input: `x`",
      "Incorrect number of call arguments, expected 1 but received 0 -- pass one argument for each input: `x`",
    ]);
    // a legacy script reports at the call
    expect(at(text, found)).toEqual(["p(1, 2)", "p(1, a: 2)", "p()"]);
  });

  it("F-112 LA-33: a typed script reports at the method name, for processes, agents and workflows, and skips the entry workflow", () => {
    const text = `nextflow.enable.types = true

process p {
    input:
    a: String
    b: String

    output:
    stdout()

    script:
    'echo'
}

workflow w {
    take:
    c: Channel<String>

    main:
    x = c

    emit:
    x
}

workflow {
    p('a')
    w()
    w(channel.of('a'))
    p('a', 'b', 'c')
}
`;
    const found = run(callArity, text);
    expect(found.map((f) => f.message)).toEqual([
      "Process `p` expects 2 argument(s) but received 1 -- pass one argument for each input: `a`, `b`",
      "Workflow `w` expects 1 argument(s) but received 0 -- pass one argument for each input: `c`",
      "Process `p` expects 2 argument(s) but received 3 -- pass one argument for each input: `a`, `b`",
    ]);
    expect(at(text, found)).toEqual(["p", "w", "p"]);
  });

  it("F-112 LA-33: null-argument: a null argument for a typed process input that isn't nullable is an unconnected input (nextflow run fails, lint accepts)", () => {
    const text = `nextflow.enable.types = true

process hello {
    input:
    name: String
    other: String?
    path: Path

    output:
    stdout()

    script:
    'echo'
}

workflow {
    hello(null, null, file('x'))
    hello('a', null, null)
}
`;
    expect(run(callArity, text)).toEqual([]);
    const found = run(nullArgument, text);
    expect(found.map((f) => f.message)).toEqual([
      "Input `name` of process `hello` is not nullable but receives `null` -- pass a value, or add `?` to the input's type",
      "Input `path` of process `hello` is not nullable but receives `null` -- pass a value, or add `?` to the input's type",
    ]);
    expect(at(text, found)).toEqual(["null", "null"]);
    // a legacy script and a legacy process are left alone
    expect(
      run(nullArgument, `${PROCESS}\nworkflow {\n    p(null)\n}\n`),
    ).toEqual([]);
  });

  it("F-112 LA-33: declared inputs are the take names, the typed input names or the legacy qualifier arguments", () => {
    const names = (text: string, kind: string): readonly string[] | null => {
      const ctx = context(text);
      const decl = (
        ctx.file as unknown as { ast: { body: { kind: string }[] } }
      ).ast.body.find((d) => d.kind === kind);
      return declaredInputs(decl as never);
    };
    expect(
      names(
        "process p {\n input:\n val x\n tuple val(a), path(b)\n path 'f.txt'\n stdin\n script:\n 'x'\n}",
        "Process",
      ),
    ).toEqual(["x", "tuple(a, b)", "path", "stdin"]);
    expect(
      names(
        "nextflow.enable.types = true\nprocess p {\n input:\n a: String\n record(b: String)\n tuple(c: String, d: Path)\n script:\n 'x'\n}",
        "Process",
      ),
    ).toEqual(["a", "record(b)", "tuple(c, d)"]);
    expect(
      names("workflow w {\n take:\n a\n b\n main:\n x = a\n}", "Workflow"),
    ).toEqual(["a", "b"]);
    expect(names("process p {\n script:\n 'x'\n}", "Process")).toEqual([]);
    expect(names("def f(a) { a }", "Function")).toBeNull();
  });

  const UNUSED = (extra = "") => `process hello {
${extra}    output:
    path 'a.txt'

    script:
    'echo'
}
process quiet {
    script:
    'echo'
}
`;
  it("F-112 LA-33: unused outputs follow the reads after the call; topic, publishDir and config publishDir exempt", () => {
    const flagged = (body: string, head = UNUSED(), configs: string[] = []) => {
      const ctx = context(`${head}\nworkflow {\n${body}\n}\n`);
      return unusedOutput.check({
        ...ctx,
        configs: () =>
          configs.map(
            (c) => (context(c, "config").file as unknown as { ast: never }).ast,
          ),
      });
    };
    // a bare call, and a call without outputs
    expect(flagged("    hello()\n    quiet()").map((f) => f.message)).toEqual([
      "The outputs of `hello` are never used -- connect it, publish it, or remove the call",
    ]);
    // a call whose result feeds something, or is assigned and read later
    expect(flagged("    hello().view()")).toEqual([]);
    expect(flagged("    hello() | view")).toEqual([]);
    expect(flagged("    r = hello()\n    r.view()")).toEqual([]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Nextflow source, not a template
    expect(flagged('    def r = hello()\n    println "${r}"')).toEqual([]);
    expect(flagged("    r = hello()\n    emit:\n    r")).toEqual([]);
    expect(flagged("    r = hello()\n    publish:\n    out = r")).toEqual([]);
    expect(flagged("    r = hello()\n    channel.of(1).map { r }")).toEqual([]);
    // an assigned result that is never read, also inside an if
    expect(flagged("    r = hello()").map((f) => f.message)).toEqual([
      "The result of `hello` is never used -- connect it, publish it, or remove the call",
    ]);
    expect(flagged("    if (params.x) {\n        hello()\n    }")).toHaveLength(
      1,
    );
    // a read before the statement does not count
    expect(flagged("    r = 1\n    r.view()\n    r = hello()")).toHaveLength(1);
    // a legacy script reads `.out` anywhere in the workflow
    expect(flagged("    hello()\n    hello.out.view()")).toEqual([]);
    expect(flagged("    hello()\n    hello.other.view()")).toHaveLength(1);
    // exemptions
    expect(flagged("    hello()", UNUSED("    publishDir 'out'\n"))).toEqual(
      [],
    );
    expect(
      flagged("    hello()", UNUSED(), ["process.publishDir = 'out'"]),
    ).toEqual([]);
    expect(
      flagged("    hello()", UNUSED(), [
        "process {\n withName: hello {\n publishDir = 'x'\n }\n}",
      ]),
    ).toEqual([]);
    expect(
      flagged("    hello()", UNUSED(), ["docker.enabled = true"]),
    ).toHaveLength(1);
    expect(
      flagged(
        "    hello()",
        UNUSED().replace("path 'a.txt'", "path 'a.txt', topic: 'versions'"),
      ),
    ).toEqual([]);
  });

  it("F-112 LA-33: a typed call with several outputs warns once per output that is never read", () => {
    const head = `nextflow.enable.types = true

process two {
    output:
    a: String = 'a'
    b: String = 'b'

    script:
    'echo'
}
process topical {
    output:
    a: String = 'a'

    topic:
    a >> 'versions'

    script:
    'echo'
}
`;
    const flagged = (body: string) =>
      unusedOutput
        .check(context(`${head}\nworkflow {\n${body}\n}\n`))
        .map((f) => f.message);
    expect(flagged("    r = two()\n    r.a.view()")).toEqual([
      "Output `b` of `two` is never used -- connect it, publish it, or remove the call",
    ]);
    expect(flagged("    r = two()\n    r.a.view()\n    r.b.view()")).toEqual(
      [],
    );
    expect(flagged("    r = two()\n    r.view()")).toEqual([]);
    expect(flagged("    r = two()")).toEqual([
      "The result of `two` is never used -- connect it, publish it, or remove the call",
    ]);
    expect(flagged("    two()")).toEqual([
      "The outputs of `two` are never used -- connect it, publish it, or remove the call",
    ]);
    expect(flagged("    topical()")).toEqual([]);
  });

  it("F-112 LA-33: a legacy script calling an included typed process may read X.out", () => {
    const typed = context(
      "nextflow.enable.types = true\n\nprocess HELLO {\n    input:\n    x: Integer\n\n    output:\n    stdout()\n\n    script:\n    'echo'\n}\n",
    );
    const caller = context(
      "workflow {\n    HELLO(1)\n    HELLO.out.view()\n}\n",
    );
    const included = {
      ...caller,
      lookup: typed.lookup,
    };
    expect(unusedOutput.check(included)).toEqual([]);
    const unread = context("workflow {\n    HELLO(1)\n}\n");
    expect(
      unusedOutput.check({ ...unread, lookup: typed.lookup }),
    ).toHaveLength(1);
  });
});

describe("F-112 AR-05 LA-33 duplicate-call", () => {
  const proc = "process HELLO {\n    script:\n    'echo'\n}\n";
  const lookupText = (body: string) => `${proc}workflow {\n${body}\n}\n`;

  it("F-112 AR-05 LA-33: the second and later calls of a process in one workflow are reported, pipes included", () => {
    const text = lookupText(
      "    HELLO()\n    HELLO()\n    channel.of(1) | HELLO\n    HELLO()",
    );
    const found = run(duplicateCall, text);
    expect(found.map((f) => f.range.line)).toEqual([7, 8, 9]);
    expect(found[0]?.message).toBe(
      "Process `HELLO` is already called in this workflow -- include it again under another name (`include { HELLO as HELLO_2 }`) to call it twice",
    );
  });

  it("F-112 AR-05 LA-33: reading X.out is not a call, and a workflow may be called twice", () => {
    expect(
      run(duplicateCall, lookupText("    HELLO()\n    HELLO.out.view()")),
    ).toEqual([]);
    const text = `workflow W {\n    main:\n    println 1\n}\nworkflow {\n    W()\n    W()\n}\n`;
    expect(run(duplicateCall, text)).toEqual([]);
  });

  it("F-112 AR-05 LA-33: only a certain repeat is reported: alternatives and separate conditions are not, a call nested under an earlier one is", () => {
    const body = (lines: string[]) => lookupText(lines.join("\n"));
    expect(
      run(
        duplicateCall,
        body([
          "    if (params.a) {",
          "        HELLO()",
          "    } else {",
          "        HELLO()",
          "    }",
        ]),
      ),
    ).toEqual([]);
    // two separate conditions may exclude each other (sarek's fastq_preprocess_gatk), so the pack stays silent
    expect(
      run(
        duplicateCall,
        body([
          "    if (params.a) {",
          "        HELLO()",
          "    }",
          "    if (params.b) {",
          "        HELLO()",
          "    }",
        ]),
      ),
    ).toEqual([]);
    const nested = run(
      duplicateCall,
      body(["    HELLO()", "    if (params.a) {", "        HELLO()", "    }"]),
    );
    expect(nested.map((f) => f.range.line)).toEqual([8]);
    const both = run(
      duplicateCall,
      body([
        "    if (params.a) {",
        "        HELLO()",
        "        HELLO()",
        "    }",
      ]),
    );
    expect(both.map((f) => f.range.line)).toEqual([8]);
    const none = (line: string) =>
      expect(run(duplicateCall, body([line]))).toEqual([]);
    none("    ch = params.a ? HELLO(1) : HELLO(2)");
    none("    ch = params.a ?: HELLO(2)");
    none("    ch = params.a && HELLO(1)");
    none("    ch = params.a || HELLO(1)");
    // the left operand and the condition always run, so a call there is a certain earlier call
    expect(
      run(
        duplicateCall,
        body(["    HELLO()", "    ch = params.a && HELLO()"]),
      ).map((f) => f.range.line),
    ).toEqual([7]);
    expect(
      run(duplicateCall, body(["    ch = HELLO() || 1", "    HELLO()"])).map(
        (f) => f.range.line,
      ),
    ).toEqual([7]);
    const two = `${proc}workflow A {\n    main:\n    HELLO()\n}\nworkflow {\n    HELLO()\n}\n`;
    expect(run(duplicateCall, two)).toEqual([]);
  });
});
