import type { ChainNode } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { FOO, ids, into, node, projectMain } from "./util";

const k = (id: string) => `main.nf#/${id}`;

const GREETERS = `process GREET {
    input:
    val x

    output:
    stdout

    script:
    "echo \${x}"
}

process TO_UPPER {
    input:
    val x

    output:
    stdout

    script:
    "echo \${x}"
}
`;

describe("F-107 AR-14 pipes", () => {
  it("F-107 AR-14: a pipe into an operator is a chain step and into a process a call; a fork calls each process with the same input", async () => {
    const p = await projectMain(`${GREETERS}
workflow {
    channel.of('Hello') | map { v -> v.trim() } | (GREET & TO_UPPER) | mix | view
}
`);
    expect(ids(p)).toEqual([
      k("channel.of@1"),
      k(".map@1"),
      k("GREET@1"),
      k("TO_UPPER@1"),
      k(".mix@1"),
    ]);
    expect(into(p, k(".map@1"), "in")).toEqual(["channel.of@1[out]"]);
    expect(into(p, k("GREET@1"), "x")).toEqual([".map@1[out]"]);
    expect(into(p, k("TO_UPPER@1"), "x")).toEqual([".map@1[out]"]);
    const tail = node(p, k(".mix@1")) as ChainNode;
    expect(tail.steps.map((s) => s.operator)).toEqual(["mix", "view"]);
    expect(into(p, tail.id, "in")).toEqual(["GREET@1[out]"]);
    expect(into(p, tail.id, "1:1")).toEqual(["TO_UPPER@1[out]"]);
    expect(p.statements).toHaveLength(1);
    expect(p.statements[0]?.modelled).toBe(true);
  });

  it("F-107 AR-14: a multi-output left side spreads over the process inputs; | set { v } binds; the last node takes the assigned name", async () => {
    const p = await projectMain(`${FOO}
process BAZ {
    input:
    val a
    path f

    output:
    path 'g'

    script:
    "touch g"
}

workflow {
    ch = channel.of(1)
    FOO(ch) | BAZ
    x = ch | map { v -> v } | filter { v -> v }
    ch | map { v -> v } | set { w }
    w | view
}
`);
    expect(ids(p)).toEqual([
      k("ch"),
      k("FOO@1"),
      k("BAZ@1"),
      k("x"),
      k("w"),
      k(".view@1"),
    ]);
    expect(into(p, k("BAZ@1"), "a")).toEqual(["FOO@1[a]"]);
    expect(into(p, k("BAZ@1"), "f")).toEqual(["FOO@1[f]"]);
    expect((node(p, k("x")) as ChainNode).steps.map((s) => s.operator)).toEqual(
      ["map", "filter"],
    );
    expect(into(p, k(".view@1"), "in")).toEqual(["w[out]"]);
    expect(p.statements.every((s) => s.modelled)).toBe(true);
  });

  it("F-107: a | that is not a pipe stays code", async () => {
    const p = await projectMain(`workflow {
    ch = channel.of(1)
    a = ch | nothing
    b = 1 | 2
    c = ch | (ch & ch)
}
`);
    expect(p.nodes.map((n) => n.kind)).toEqual([
      "factory",
      "code",
      "code",
      "code",
    ]);
    const typed = await projectMain(`nextflow.enable.types = true

workflow {
    main:
    ch = channel.of(1)
    ch | view
}
`);
    expect(typed.nodes.map((n) => n.kind)).toEqual(["factory", "code"]);
  });

  it("F-107 AR-14: pipe, fork, set/tap, guard and alias feeds leave Port.argument null, so an edit never patches a process name", async () => {
    const p = await projectMain(`${GREETERS}
workflow {
    ch = channel.of('Hello')
    ch | GREET | (GREET & TO_UPPER) | mix | view
    ch.set { a }
    ch.tap { b }
    c = ch
    if (params.flag) {
        d = c | TO_UPPER
    }
}
`);
    const inputs = p.nodes.flatMap((n) =>
      n.inputs.map((i) => `${n.id}[${i.id}]`),
    );
    expect(inputs).toContain(k("GREET@2[x]"));
    expect(inputs).toContain(k(".mix@1[1:1]"));
    for (const n of p.nodes)
      for (const input of n.inputs)
        expect(input.argument, `${n.id}[${input.id}]`).toBeNull();
  });
});
