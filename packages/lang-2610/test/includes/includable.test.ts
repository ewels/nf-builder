import { readFileSync } from "node:fs";
import type { ScriptAst } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { includable } from "../../src/includes/includable.ts";
import { parseScriptSource } from "../../src/source/parse-source.ts";

function astOf(text: string): ScriptAst {
  const parsed = parseScriptSource(text);
  if (!parsed.ast) throw new Error("not parsed");
  return parsed.ast;
}
const fixture = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("includable declarations", () => {
  it("F-105 AR-03: declarations are includable by name in nf-lang's order, first wins", () => {
    const ast = astOf(`nextflow.enable.types = true

record Sample {
    id: String
}

enum Colour {
    RED,
    GREEN
}

def fn(x) {
    return x
}

process P {
    script:
    'echo'
}

workflow W {
    main:
    P()
}

workflow {
    P()
}
`);
    const map = includable(ast);
    expect([...map.keys()]).toEqual([
      "W",
      "workflow",
      "P",
      "fn",
      "Sample",
      "Colour",
    ]);
    expect(map.get("W")?.declaration.kind).toBe("Workflow");
    expect(map.get("P")?.declaration.kind).toBe("Process");
    expect(map.get("fn")?.declaration.kind).toBe("Function");
    expect(map.get("Sample")?.declaration.kind).toBe("Record");
    expect(map.get("Colour")?.declaration.kind).toBe("Enum");
    expect([...map.values()].filter((i) => i.pipeline)).toHaveLength(1);

    // duplicates: the first declaration of a name wins; a workflow beats a process of the same name
    const dup = astOf(`process X {
    script:
    'one'
}

process X {
    script:
    'two'
}

workflow X {
    main:
    X()
}
`);
    const d = includable(dup);
    expect(d.get("X")?.declaration.kind).toBe("Workflow");
    const procs = astOf(`process X {
    script:
    'one'
}

process X {
    script:
    'two'
}
`);
    const x = includable(procs).get("X")?.declaration;
    expect(x?.range.line).toBe(1);
  });

  it("F-105 AR-03: the entry workflow is includable as workflow and the params block as params", () => {
    const ast = astOf(fixture("../ast/fixtures/pipelines/rnaseq.nf"));
    const map = includable(ast);
    expect(map.get("workflow")).toMatchObject({
      pipeline: true,
      declaration: { kind: "Workflow", name: null },
    });
    expect(map.get("params")).toMatchObject({
      pipeline: true,
      declaration: { kind: "ParamsBlock" },
    });
    // a definition named params is claimed first
    const claimed = includable(
      astOf(`params {
    a: String
}

def params() {
    return 1
}
`),
    );
    expect(claimed.get("params")).toMatchObject({
      pipeline: false,
      declaration: { kind: "Function" },
    });
  });

  it("F-105 AR-03 ADR-0004: an unparsed declaration is includable by its head", () => {
    const flag = fixture(
      "../../../../tools/corpus/fixtures/typed-without-flag.nf",
    );
    const order = fixture("../../../../tools/corpus/fixtures/section-order.nf");
    const out: unknown[] = [];
    for (const text of [flag, order]) {
      const parsed = parseScriptSource(text);
      expect(parsed.ast).not.toBeNull();
      const map = includable(parsed.ast as ScriptAst);
      out.push([
        parsed.status,
        [...map].map(([k, v]) => `${k}:${v.declaration.kind}`),
      ]);
    }
    expect(out).toEqual([
      ["partial", ["HELLO:Unparsed", "GOODBYE:Process"]],
      ["partial", ["LATE_INPUT:Unparsed", "ON_TIME:Process"]],
    ]);
    const partial = parseScriptSource(`process GOOD {
    script:
    'echo'
}

process BAD {
    script:
    def a = = 1
    'echo'
}

workflow {
    GOOD()
    def b = = 2
}
`);
    expect(partial.status).toBe("partial");
    const map = includable(partial.ast as ScriptAst);
    expect(map.get("GOOD")?.declaration.kind).toBe("Process");
    expect(map.get("BAD")?.declaration.kind).toBe("Unparsed");
    expect(map.get("workflow")).toMatchObject({
      pipeline: true,
    });
  });

  it("F-105: feature flags, includes, legacy params, output blocks and statements are not includable", () => {
    const ast = astOf(`nextflow.enable.types = true

include { A } from './a'

params.x = 1

output {
}

println 'hi'
`);
    expect([...includable(ast).keys()]).toEqual([]);
  });
});
