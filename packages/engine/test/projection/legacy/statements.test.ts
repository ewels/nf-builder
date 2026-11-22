import type { ChainNode } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { FOO, ids, into, node, outType, projectMain } from "./util";

const k = (id: string) => `main.nf#/${id}`;

describe("F-107 AR-10 AR-14 statement forms", () => {
  it("F-107 AR-10: an assignment of a graph reference creates no node and binds the variable; def x and x = null bind nothing", async () => {
    const p = await projectMain(`workflow {
    ch = channel.of(1)
    def a = ch
    b = a
    def c
    d = null
    b.view()
}
`);
    expect(ids(p)).toEqual([k("ch"), k(".view@1")]);
    expect(into(p, k(".view@1"), "in")).toEqual(["ch[out]"]);
    expect(p.edges[0]?.variable).toBe("b");
    expect(p.statements.map((s) => [s.nodes, s.binds, s.modelled])).toEqual([
      [[k("ch")], ["ch"], true],
      [[], ["a"], true],
      [[], ["b"], true],
      [[], ["c"], true],
      [[], ["d"], true],
      [[k(".view@1")], [], true],
    ]);
  });

  it("F-107 AR-10: CALL(…).name is that output of the nested call", async () => {
    const p = await projectMain(`${FOO}
workflow {
    ch = channel.of(1)
    x = FOO(ch).f
    x.view()
    FOO(ch)[0].view()
}
`);
    expect(ids(p)).toEqual([
      k("ch"),
      k("FOO@1"),
      k(".view@1"),
      k("FOO@2"),
      k(".view@2"),
    ]);
    expect(into(p, k(".view@1"), "in")).toEqual(["FOO@1[f]"]);
    expect(into(p, k(".view@2"), "in")).toEqual(["FOO@2[a]"]);
  });

  it("F-107 AR-14 AR-12: set binds the expression's top node; tap ends the chain and keys its prefix", async () => {
    const p = await projectMain(`workflow {
    channel.of('x').tap { copy }.set { original }
    copy.view()
    original.view()
    ch = channel.of(1)
    ch.map { v -> v }.tap { mid }.filter { v -> v }.set { end }
    end.view()
    ch.map { v -> v }.set { w }
    other = w
}
`);
    expect(ids(p)).toEqual([
      k("copy"),
      k(".view@1"),
      k(".view@2"),
      k("ch"),
      k("mid"),
      k("end"),
      k(".view@3"),
      k("w"),
    ]);
    expect(into(p, k(".view@2"), "in")).toEqual(["copy[out]"]);
    expect(p.edges.find((e) => e.to.node === k(".view@2"))?.variable).toBe(
      "original",
    );
    expect(
      (node(p, k("mid")) as ChainNode).steps.map((s) => s.operator),
    ).toEqual(["map"]);
    expect(into(p, k("end"), "in")).toEqual(["mid[out]"]);
    expect(p.statements.every((s) => s.modelled)).toBe(true);
    // nf-lang's shape (checked with nextflow lint): the closure's only statement is a bare variable, with or without
    // parameters, and the closure may be in parentheses; anything else is not an assignment
    const q = await projectMain(`workflow {
    ch = channel.of(1)
    ch.set({ a })
    ch.set { v -> v }
    ch.set { 1 }
    ch.set { w; x }
}
`);
    expect(q.statements.map((s) => [s.binds, s.modelled])).toEqual([
      [["ch"], true],
      [["a"], true],
      [["v"], true],
      [[], false],
      [[], false],
    ]);
  });

  it("F-107 AR-14: legacy-only operators are chain steps with known false and the documented result kind, and unknown channel factories are factories; typed workflows model neither", async () => {
    const p = await projectMain(`workflow {
    ch = channel.of(1, 2)
    a = ch.first()
    b = ch.concat(channel.of(3))
    c = ch.collate(2)
    channel.from(1, 2).view()
}
`);
    expect(ids(p)).toEqual([
      k("ch"),
      k("a"),
      k("channel.of@1"),
      k("b"),
      k("c"),
      k("channel.from@1"),
      k(".view@1"),
    ]);
    expect((node(p, k("a")) as ChainNode).steps.map((s) => s.known)).toEqual([
      false,
    ]);
    expect(outType(node(p, k("a")), "out")).toBe("Value<Integer>");
    expect(outType(node(p, k("b")), "out")).toBe("Channel<Integer>");
    expect(outType(node(p, k("c")), "out")).toBe("Channel<?>");
    expect(outType(node(p, k("channel.from@1")), "out")).toBe("?");
    const typed = await projectMain(`nextflow.enable.types = true

workflow {
    main:
    ch = channel.of(1, 2)
    a = ch.first()
}
`);
    expect(typed.nodes.map((n) => n.kind)).toEqual(["factory", "code"]);
  });

  it("F-107 LA-26: legacy params.x = … give :params ports in source order, before the undeclared reads", async () => {
    const p = await projectMain(`params.reads = 'x'
params.outdir = 'out'

workflow {
    channel.fromPath(params.reads).view()
    channel.of(params.other).view()
}
`);
    const params = node(p, k(":params"));
    expect(params.outputs.map((o) => o.id)).toEqual([
      "reads",
      "outdir",
      "other",
    ]);
  });
});
