import type { Guard } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { ids, into, node, projectMain } from "./util";

const k = (id: string) => `main.nf#/${id}`;

const PROCESSES = ["ONE", "TWO", "THREE"]
  .map(
    (name) => `process ${name} {
    input:
    val x

    output:
    val x, emit: a

    script:
    "echo \${x}"
}
`,
  )
  .join("\n");

const branches = (guards: readonly Guard[]) => guards.map((g) => g.branch);

describe("F-107 AR-10 conditional dataflow", () => {
  it("F-107 AR-10: statements inside an if with dataflow become nodes carrying their guards; an if without dataflow is one code node", async () => {
    const p = await projectMain(`${PROCESSES}
workflow {
    ch = channel.of(1)
    if (params.mode == 'one') {
        ONE(ch)
    }
    else if (params.mode == 'two') {
        TWO(ch)
    }
    else {
        THREE(ch)
    }
    if (params.mode == 'x') {
        log.info 'no dataflow here'
    }
}
`);
    expect(ids(p)).toEqual([
      k(":params"),
      k("ch"),
      k("ONE@1"),
      k("TWO@1"),
      k("THREE@1"),
      k(":code@1"),
    ]);
    const guards = (id: string) => branches(node(p, id).guards);
    expect(guards(k("ch"))).toEqual([]);
    expect(guards(k("ONE@1"))).toEqual(["then"]);
    expect(guards(k("TWO@1"))).toEqual(["else", "then"]);
    expect(guards(k("THREE@1"))).toEqual(["else", "else"]);
    expect(guards(k(":code@1"))).toEqual([]);
    // the conditions are the if statements' conditions, outer to inner
    const text = `${PROCESSES}\nworkflow {\n    ch = channel.of(1)\n    if (params.mode == 'one') {`;
    expect(node(p, k("TWO@1")).guards[0]?.condition.start).toBe(
      text.indexOf("params.mode == 'one'"),
    );
    // a transparent if is replaced by its branch statements; the plain one is listed once, as code
    expect(
      p.statements.map((s) => [s.nodes, s.modelled, branches(s.guards)]),
    ).toEqual([
      [[k("ch")], true, []],
      [[k("ONE@1")], true, ["then"]],
      [[k("TWO@1")], true, ["else", "then"]],
      [[k("THREE@1")], true, ["else", "else"]],
      [[k(":code@1")], false, []],
    ]);
  });

  it("F-107 AR-10: after an if, uses read every reaching definition; without else, the previous one too; defs inside a branch are gone", async () => {
    const p = await projectMain(`${PROCESSES}
workflow {
    ch = channel.of(1)
    res = channel.empty()
    if (params.mode == 'one') {
        ONE(ch)
        res = res.mix(ONE.out.a)
    }
    else if (params.mode == 'two') {
        TWO(ch)
        def tmp = TWO.out.a
        res = res.mix(tmp)
    }
    else {
        THREE(ch)
        res = THREE.out.a
    }
    res.view()
    tmp.view()
    more = channel.empty()
    if (params.mode == 'one') {
        more = more.mix(ch)
    }
    more.view()
}
`);
    expect(into(p, k(".view@1"), "in")).toEqual([
      "res~2[out]~",
      "res~3[out]~",
      "THREE@1[a]~",
    ]);
    // each branch starts from the definitions before the if; the def inside the else-if branch reads TWO's output
    expect(into(p, k("res~3"), "in")).toEqual(["res[out]"]);
    expect(into(p, k("res~3"), "1:1")).toEqual(["TWO@1[a]"]);
    expect(node(p, k(":code@1")).kind).toBe("code");
    expect(into(p, k(".view@2"), "in")).toEqual(["more[out]~", "more~2[out]~"]);
  });

  it("F-107 AR-14: .out after an if/else reaches the calls in both branches", async () => {
    const p = await projectMain(`${PROCESSES}
workflow {
    ch = channel.of(1)
    ONE(ch)
    TWO(ch)
    if (params.flag) {
        runner = ONE
    }
    else {
        runner = TWO
    }
    runner.out.a.view()
    if (params.flag) {
        THREE(ch)
    }
    else {
        THREE(ch)
    }
    THREE.out.a.view()
}
`);
    expect(into(p, k(".view@1"), "in")).toEqual(["ONE@1[a]~", "TWO@1[a]~"]);
    expect(into(p, k(".view@2"), "in")).toEqual(["THREE@1[a]~", "THREE@2[a]~"]);
  });

  it("F-107 AR-10 AR-11: a ternary over dataflow makes guarded nodes keyed x and x~2 and binds x to both; elvis likewise", async () => {
    const p = await projectMain(`${PROCESSES}
workflow {
    ch = channel.of(1)
    x = params.flag ? ch.map { v -> v } : ch.filter { v -> v }
    x.view()
    y = params.mode ?: ch.map { v -> v }
    y.view()
    pick = params.flag ? ONE(ch).a : TWO(ch).a
    z = params.flag ? ch.map { v -> v } : null
    w = params.flag ? 1 : 2
}
`);
    expect(ids(p)).toEqual([
      k(":params"),
      k("ch"),
      k("x"),
      k("x~2"),
      k(".view@1"),
      k("y"),
      k(".view@2"),
      k("ONE@1"),
      k("TWO@1"),
      k("z"),
      k("w"),
    ]);
    expect(node(p, k("w")).kind).toBe("code");
    expect(branches(node(p, k("x")).guards)).toEqual(["then"]);
    expect(branches(node(p, k("x~2")).guards)).toEqual(["else"]);
    expect(into(p, k(".view@1"), "in")).toEqual(["x[out]~", "x~2[out]~"]);
    expect(branches(node(p, k("y")).guards)).toEqual(["else"]);
    expect(into(p, k(".view@2"), "in")).toEqual([":params[mode]~", "y[out]~"]);
    expect(branches(node(p, k("z")).guards)).toEqual(["then"]);
    const modelled = p.statements.map((s) => s.modelled);
    expect(modelled).toEqual([true, true, true, true, true, true, true, false]);
  });
});
