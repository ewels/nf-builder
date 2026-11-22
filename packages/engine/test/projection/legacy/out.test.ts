import { describe, expect, it } from "vitest";
import { FOO, ids, into, node, projectMain } from "./util";

const short = (id: string) => `main.nf#/${id}`;

describe("F-107 AR-14 .out", () => {
  it("F-107 AR-14: X.out.name and X.out[n] read that output of the reaching call of X; X.out reads all its outputs", async () => {
    const p = await projectMain(`${FOO}
workflow {
    ch = channel.of(1)
    FOO(ch)
    FOO.out.a.view()
    FOO.out[1].view()
    FOO.out.map { v -> v }
}
`);
    expect(ids(p)).toEqual([
      short("ch"),
      short("FOO@1"),
      short(".view@1"),
      short(".view@2"),
      short(".map@1"),
    ]);
    expect(into(p, short(".view@1"), "in")).toEqual(["FOO@1[a]"]);
    expect(into(p, short(".view@2"), "in")).toEqual(["FOO@1[f]"]);
    expect(into(p, short(".map@1"), "in")).toEqual(["FOO@1[a]~", "FOO@1[f]~"]);
    const edge = p.edges.find((e) => e.to.node === short(".view@1"));
    expect(edge?.variable).toBe("FOO.out.a");
    // a workflow callee works the same way
    const q = await projectMain(
      `${FOO}
workflow SUB {
    take:
    ch

    main:
    FOO(ch)

    emit:
    res = FOO.out.a
}

workflow {
    SUB(channel.of(1))
    SUB.out.res.view()
}
`,
      {},
    );
    expect(into(q, short("SUB@1"), "ch")).toEqual(["channel.of@1[out]"]);
    expect(into(q, short(".view@1"), "in")).toEqual(["SUB@1[res]"]);
  });

  it("F-107 AR-14: a variable assigned a process name resolves .out through that process's calls", async () => {
    const p = await projectMain(`${FOO}
workflow {
    ch = channel.of(1)
    FOO(ch)
    runner = FOO
    runner.out.a.view()
    runner.out[1].view()
}
`);
    expect(ids(p)).toEqual([
      short("ch"),
      short("FOO@1"),
      short(".view@1"),
      short(".view@2"),
    ]);
    expect(into(p, short(".view@1"), "in")).toEqual(["FOO@1[a]"]);
    expect(into(p, short(".view@2"), "in")).toEqual(["FOO@1[f]"]);
  });

  it("F-107 AR-14: .out before any call is not a reference; an unresolved callee gains output ports on demand", async () => {
    const p = await projectMain(`${FOO}
include { BAR } from './nope.nf'

workflow {
    FOO.out.a.view()
    ch = channel.of(1)
    BAR(ch)
    BAR.out.stats.view()
    BAR.out[2].view()
    FOO(ch)
}
`);
    expect(node(p, short(":code@1")).kind).toBe("code");
    const bar = node(p, short("BAR@1"));
    expect(bar.outputs.map((o) => o.id)).toEqual(["out", "stats", "[2]"]);
    expect(into(p, short(".view@1"), "in")).toEqual(["BAR@1[stats]"]);
    expect(into(p, short(".view@2"), "in")).toEqual(["BAR@1[[2]]"]);
  });

  it("F-107 AR-14 AR-10: .out in emits, arguments and chain receivers wires the right port; typed workflows don't resolve .out", async () => {
    const p = await projectMain(
      `${FOO}
workflow SUB {
    take:
    ch

    main:
    FOO(ch)
    BAZ(FOO.out.f)

    emit:
    res = FOO.out.a
    other = FOO.out[1]
}

process BAZ {
    input:
    path f

    output:
    path 'g'

    script:
    "touch g"
}
`,
      {},
      "SUB",
    );
    const sub = (id: string) => `main.nf#SUB/${id}`;
    expect(into(p, sub("BAZ@1"), "f")).toEqual(["FOO@1[f]"]);
    expect(into(p, sub(":emit:res"), "in")).toEqual(["FOO@1[a]"]);
    expect(into(p, sub(":emit:other"), "in")).toEqual(["FOO@1[f]"]);
    const typed = await projectMain(
      `nextflow.enable.types = true

workflow {
    main:
    ch = channel.of(1)
    FOO.out.view()
}
`,
    );
    expect(ids(typed)).toEqual([short("ch"), short(":code@1")]);
  });
});
