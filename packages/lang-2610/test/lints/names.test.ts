import { describe, expect, it } from "vitest";
import {
  agentOutput,
  configIncludePlacement,
  duplicateName,
  featureFlag,
} from "../../src/lints/names.ts";
import {
  missingType,
  publishTypeIgnored,
  typedProcessOutputs,
} from "../../src/lints/typed.ts";
import { at, run } from "./context.ts";

const TYPED = "nextflow.enable.types = true\n\n";

describe("F-112 LA-37 typed-code warnings", () => {
  it("F-112 LA-37: missing types are found in inputs, record fields, tuple components, agent inputs and typed takes, at the name", () => {
    const text = `${TYPED}process p {
    input:
    a
    record(b, c: String)
    tuple(d: String, e)
    output:
    stdout()
    script:
    'x'
}
agent qa {
    input:
    q
    output:
    r: String
    prompt:
    'go'
}
workflow w {
    take:
    t
    u: Channel<String>
    main:
    println t
}
`;
    const found = run(missingType, text);
    expect(at(text, found)).toEqual(["a", "b", "e", "q", "t"]);
    expect(found.map((f) => f.message.split(" should")[0])).toEqual([
      "Process input",
      "Record field",
      "Tuple component",
      "Process input",
      "Typed workflow input",
    ]);
    expect(found[0]?.message).toBe(
      "Process input should have a type annotation -- add a type, such as `a: String`",
    );
  });

  it("F-112 LA-37: legacy processes and workflows have no missing types", () => {
    const text =
      "process p {\n    input:\n    val a\n    script:\n    'x'\n}\nworkflow w {\n    take:\n    t\n    main:\n    println t\n}\n";
    expect(run(missingType, text)).toEqual([]);
  });

  it("F-112 LA-37: several named process outputs warn once at the output label; a single output or an emit expression does not", () => {
    const body = (outputs: string) =>
      `${TYPED}process p {\n    output:\n    ${outputs}\n    script:\n    'x'\n}\n`;
    const two = body("a = stdout()\n    b = file('x')");
    expect(at(two, run(typedProcessOutputs, two))).toEqual(["output:"]);
    expect(run(typedProcessOutputs, body("a = stdout()"))).toEqual([]);
    expect(run(typedProcessOutputs, body("stdout()"))).toEqual([]);
  });

  it("F-112 LA-37: a type in a publish statement is flagged at name and type, and the fix deletes the annotation", () => {
    const text = `${TYPED}workflow {
    main:
    x = 1

    publish:
    a : Integer = x
    b = x
}
`;
    const found = run(publishTypeIgnored, text);
    expect(at(text, found)).toEqual(["a : Integer"]);
    const [edit] = found[0]?.fix?.edits ?? [];
    expect(text.slice(0, edit?.start) + text.slice(edit?.end)).toContain(
      "    a = x\n",
    );
  });
});

describe("F-112 LA-31 names and placement", () => {
  it("F-112 LA-31: an unknown feature flag is flagged with the known flags listed", () => {
    const text =
      "nextflow.enable.types = true\nnextflow.enable.foo = true\nworkflow {\n}\n";
    const found = run(featureFlag, text);
    expect(at(text, found)).toEqual(["nextflow.enable.foo = true"]);
    expect(found[0]?.message).toMatch(
      /^Unrecognized feature flag 'nextflow\.enable\.foo' -- use one of nextflow\.enable\./,
    );
  });

  it("F-112 LA-31: config includes are allowed at the top level and directly in a profile only", () => {
    const text = [
      "includeConfig 'a.config'",
      "profiles {",
      "    includeConfig 'b.config'",
      "    big {",
      "        includeConfig 'c.config'",
      "        process.cpus = 2",
      "    }",
      "    small {",
      "        process {",
      "            includeConfig 'd.config'",
      "        }",
      "        process {",
      "            withName: 'X' {",
      "                includeConfig 'e.config'",
      "            }",
      "        }",
      "    }",
      "}",
      "process {",
      "    includeConfig 'f.config'",
      "}",
    ].join("\n");
    const found = run(configIncludePlacement, text, "config");
    expect(found.map((f) => f.range.line)).toEqual([3, 10, 14, 20]);
    expect(run(configIncludePlacement, "x = 1\n")).toEqual([]);
  });

  it("F-112 AR-05: duplicates are reported in nf-lang's declaration order, and functions may overload", () => {
    const text = `${TYPED}params {
    a: String
    a: Integer
}
process hello {
    script:
    'x'
}
process hello {
    script:
    'y'
}
workflow hello {
}
def f() {
    return 1
}
def f(x) {
    return x
}
def hello() {
    return 2
}
record R {
    x: String
}
record R {
    y: String
}
enum R {
    A
}
`;
    const found = run(duplicateName, text);
    expect(
      found.map((f) => [f.range.line, f.message.split(" -- ")[0]]),
    ).toEqual([
      [5, "Parameter `a` is already declared"],
      // lint reports the same lines: the workflow clashes with each process, then the function with the workflow
      [15, "`hello` is already declared"],
      [15, "`hello` is already declared"],
      [23, "`hello` is already declared"],
      [29, "`R` is already declared"],
      [32, "`R` is already declared"],
      [32, "`R` is already declared"],
    ]);
    expect(
      found.every((f) =>
        f.message.endsWith(
          "-- remove the duplicate, or rename one or alias it with `as`",
        ),
      ),
    ).toBe(true);
    expect(found.every((f) => f.fix === undefined)).toBe(true);
  });
});

describe("F-112 LA-31 agent outputs", () => {
  const agent = (output: string, extra = "") =>
    `${TYPED}${extra}agent qa {\n    input:\n    q: String\n    output:\n    ${output}\n    prompt:\n    'go'\n}\n`;
  const messages = (output: string, extra?: string) =>
    run(agentOutput, agent(output, extra)).map(
      (f) => f.message.split(" -- ")[0],
    );

  it("F-112 LA-31: agent output types are checked through record fields, with a cycle guard", () => {
    const records = `record Node {\n    next: Node\n    n: Integer\n}\nrecord Bad {\n    inner: List<Map<String, String>>\n}\nrecord Wrap {\n    bad: Bad\n}\n`;
    expect(messages("a: Node", records)).toEqual([]);
    expect(messages("a: List<Node>", records)).toEqual([]);
    expect(messages("a: Wrap", records)).toEqual([
      "Agent output `a` has unsupported field `inner` with type List<Map<String, String>>",
    ]);
    expect(
      messages("a: Path\n    b: Boolean\n    c: Float\n    d: List<Integer>"),
    ).toEqual([]);
    expect(messages("a: Map<String, String>")).toEqual([
      "Agent output `a` has unsupported type Map<String, String>",
    ]);
    expect(messages("a: Unknown")).toEqual([
      "Agent output `a` has unsupported type Unknown",
    ]);
  });

  it("F-112 LA-31: an agent output without a type is flagged; an assignment or stdout() is not checked", () => {
    expect(messages("a")).toEqual(["Agent output `a` should declare a type"]);
    expect(messages("a = stdout()\n    b: String = stdout()")).toEqual([]);
    expect(messages("stdout()")).toEqual([]);
  });

  it("F-112 LA-31: env and eval are not defined in an agent output, unless the script defines them", () => {
    expect(messages("a = eval('date')")).toEqual(["`eval` is not defined"]);
    expect(messages("a = env('X')")).toEqual(["`env` is not defined"]);
    expect(
      messages("a = eval('date')", "def eval(x) {\n    return x\n}\n"),
    ).toEqual([]);
  });
});
