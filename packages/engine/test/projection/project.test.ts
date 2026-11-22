import { fileURLToPath } from "node:url";
import type {
  CallNode,
  ChainNode,
  GraphEdge,
  GraphNode,
  Projection,
} from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectModel } from "../../src/model/project";
import type { Projector } from "../../src/projection/project";
import { formatFlowType } from "../../src/projection/types";
import { openTree, projectorFor, projectorForFiles } from "./open";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const PREPARE_FILE = "subworkflows/local/prepare/main.nf";

let model: ProjectModel;
let projector: Projector;
beforeAll(async () => {
  model = await openTree(FIXTURES, { stripProbes: true });
  projector = await projectorFor(model);
});

function must(p: Projector, path: string, workflow: string | null): Projection {
  const projection = p.project(path, workflow);
  if (projection === null) throw new Error(`no projection for ${path}`);
  return projection;
}
const node = (p: Projection, id: string): GraphNode => {
  const found = p.nodes.find((n) => n.id === id);
  if (found === undefined)
    throw new Error(
      `no node ${id}; have ${p.nodes.map((n) => n.id).join(", ")}`,
    );
  return found;
};
const into = (p: Projection, id: string, port: string): GraphEdge[] =>
  p.edges.filter((e) => e.to.node === id && e.to.port === port);
const ports = (n: GraphNode, side: "inputs" | "outputs") =>
  n[side].map((x) => x.id);
const type = (n: GraphNode, port: string): string => {
  const found = n.outputs.find((x) => x.id === port);
  if (found?.type == null) return "-";
  return formatFlowType(found.type);
};

describe("F-106 AR-10 LA-20 projector", () => {
  it("F-106 AR-10 LA-20: a typed process call has one input per input declaration, typed as declared, and one output per named output; topics are not ports", () => {
    const p = must(projector, PREPARE_FILE, "PREPARE");
    const aligned = node(p, `${PREPARE_FILE}#PREPARE/aligned`) as CallNode;
    expect(aligned.kind).toBe("call");
    expect(aligned.callee).toMatchObject({
      name: "ALIGN",
      kind: "process",
      status: "modelled",
      typed: true,
      path: "modules/local/align/main.nf",
    });
    expect(ports(aligned, "inputs")).toEqual(["$1", "index"]);
    expect(aligned.inputs[0]?.label).toBe("record(id, reads)");
    expect(aligned.inputs[1]?.type).toEqual({
      dataflow: "plain",
      element: { name: "Path", args: [], nullable: false },
    });
    expect(ports(aligned, "outputs")).toEqual(["bam", "log"]);
    expect(type(aligned, "bam")).toBe("Channel<Path>");
    expect(type(aligned, "log")).toBe("Channel<String>");
    const base = `${PREPARE_FILE}#PREPARE`;
    expect(into(p, aligned.id, "$1")).toMatchObject([
      {
        from: { node: `${base}/:take:samples`, port: "out" },
        variable: "samples",
        direct: true,
      },
    ]);
    expect(into(p, aligned.id, "index")).toMatchObject([
      {
        from: { node: `${base}/index`, port: "out" },
        variable: "index",
        direct: true,
      },
    ]);
  });

  it("F-106 LA-20: a single unnamed process output is one port named out", () => {
    const p = must(projector, PREPARE_FILE, "PREPARE");
    const index = node(p, `${PREPARE_FILE}#PREPARE/index`);
    expect(ports(index, "inputs")).toEqual(["fasta"]);
    expect(ports(index, "outputs")).toEqual(["out"]);
    expect(type(index, "out")).toBe("Value<Path>");
  });

  it("F-106 LA-22: a workflow call has one input port per take and one output per emit; takes are nodes in its own projection", () => {
    const main = must(projector, "main.nf", null);
    const prepared = node(main, "main.nf#/prepared") as CallNode;
    expect(prepared.callee).toMatchObject({
      name: "PREPARE",
      kind: "workflow",
      status: "modelled",
      typed: true,
      path: PREPARE_FILE,
    });
    expect(ports(prepared, "inputs")).toEqual(["samples", "fasta"]);
    expect(ports(prepared, "outputs")).toEqual(["bams", "logs", "index"]);
    expect(type(prepared, "bams")).toBe("Channel<Path>");
    // inferred from the callee's own projection: the emit's source, wrapped by workflowEmitType
    expect(type(prepared, "logs")).toBe("Channel<String>");
    expect(type(prepared, "index")).toBe("Value<Path>");
    const samples = into(main, prepared.id, "samples");
    expect(samples).toMatchObject([
      {
        from: { node: "main.nf#/:params", port: "samples" },
        variable: "params.samples",
        direct: true,
      },
    ]);
    const p = must(projector, PREPARE_FILE, "PREPARE");
    const take = node(p, `${PREPARE_FILE}#PREPARE/:take:samples`);
    expect(take.kind).toBe("take");
    expect(take.inputs).toEqual([]);
    expect(type(take, "out")).toBe("Channel<Sample>");
    expect(p.nodes.slice(0, 2).map((n) => n.kind)).toEqual(["take", "take"]);
    const base = `${PREPARE_FILE}#PREPARE`;
    expect(p.nodes.slice(-3).map((n) => n.id)).toEqual([
      `${base}/:emit:bams`,
      `${base}/:emit:logs`,
      `${base}/:emit:index`,
    ]);
    const bams = node(p, `${base}/:emit:bams`);
    expect(bams.kind).toBe("emit");
    expect(bams).toMatchObject({ name: "bams", outputs: [] });
    expect(bams.inputs).toMatchObject([
      {
        id: "in",
        type: {
          dataflow: "channel",
          element: { name: "Path", args: [], nullable: false },
        },
      },
    ]);
    expect(into(p, bams.id, "in")).toMatchObject([
      { from: { node: `${base}/bams`, port: "out" }, variable: "bams" },
    ]);
    expect(into(p, `${base}/:emit:logs`, "in")).toMatchObject([
      {
        from: { node: `${base}/aligned`, port: "log" },
        variable: "aligned.log",
        direct: true,
      },
    ]);
    expect(node(p, `${base}/:emit:logs`).inputs[0]?.type).toBeNull();
    expect(into(p, `${base}/:emit:index`, "in")).toMatchObject([
      { from: { node: `${base}/index`, port: "out" }, variable: "index" },
    ]);
  });

  it("F-106 AR-12 LA-24: a chain is the maximal run of operator calls with no assignment between; receiver and graph-fed arguments are ports, closures are not; one output", () => {
    const main = must(projector, "main.nf", null);
    const joined = node(main, "main.nf#/joined") as ChainNode;
    expect(joined.kind).toBe("chain");
    expect(joined.steps.map((s) => s.operator)).toEqual(["filter", "combine"]);
    expect(joined.steps.every((s) => s.known)).toBe(true);
    expect(ports(joined, "inputs")).toEqual(["in", "2:1"]);
    expect(joined.inputs[1]?.label).toBe("combine(fields)");
    expect(ports(joined, "outputs")).toEqual(["out"]);
    expect(type(joined, "out")).toBe("Channel<Record>");
    expect(into(main, joined.id, "in")).toMatchObject([
      {
        from: { node: "main.nf#/prepared", port: "bams" },
        variable: "prepared.bams",
        direct: true,
      },
    ]);
    expect(into(main, joined.id, "2:1")).toMatchObject([
      {
        from: { node: "main.nf#/prepared", port: "index" },
        variable: "prepared.index",
        direct: true,
      },
    ]);
  });

  it("F-106 AR-12: an assignment ends a chain", () => {
    const main = must(projector, "main.nf", null);
    const ids = main.nodes.map((n) => n.id);
    const first = ids.indexOf("main.nf#/ch_names");
    expect(ids.slice(first, first + 4)).toEqual([
      "main.nf#/ch_names",
      "main.nf#/channel.of@1",
      "main.nf#/ch_names~2",
      "main.nf#/.view@1",
    ]);
    const mix = node(main, "main.nf#/ch_names~2") as ChainNode;
    expect(mix.steps.map((s) => s.operator)).toEqual(["mix"]);
    expect(into(main, mix.id, "in")).toMatchObject([
      {
        from: { node: "main.nf#/ch_names", port: "out" },
        variable: "ch_names",
      },
    ]);
    expect(into(main, mix.id, "1:1")).toMatchObject([
      {
        from: { node: "main.nf#/channel.of@1", port: "out" },
        variable: null,
        direct: true,
      },
    ]);
    const view = node(main, "main.nf#/.view@1") as ChainNode;
    expect(into(main, view.id, "in")).toMatchObject([
      { from: { node: "main.nf#/ch_names~2", port: "out" } },
    ]);
    expect(ports(view, "outputs")).toEqual(["out"]);
  });

  it("F-106 LA-25 LA-28: a factory has no inputs and one output typed from the catalogue", async () => {
    const p = must(
      await projectorForFiles({
        "main.nf":
          "workflow {\n    a = channel.fromPath('x')\n    b = Channel.of('a', 'b')\n    c = channel.of(1, 'a')\n}\n",
      }),
      "main.nf",
      null,
    );
    for (const [id, expected] of [
      ["a", "Channel<Path>"],
      ["b", "Channel<String>"],
      ["c", "Channel<?>"],
    ] as const) {
      const n = node(p, `main.nf#/${id}`);
      expect(n.kind).toBe("factory");
      expect(n.inputs).toEqual([]);
      expect(ports(n, "outputs")).toEqual(["out"]);
      expect(type(n, "out")).toBe(expected);
    }
    expect(node(p, "main.nf#/b")).toMatchObject({
      namespace: "Channel",
      factory: "of",
    });
  });

  it("F-106 LA-26: the params node has one output per declared parameter, and undeclared reads add ports", () => {
    const main = must(projector, "main.nf", null);
    const params = node(main, "main.nf#/:params");
    expect(params.kind).toBe("params");
    expect(ports(params, "outputs")).toEqual(["samples", "fasta", "names"]);
    expect(type(params, "samples")).toBe("Channel<Sample>");
    expect(type(params, "names")).toBe("List<String>");
    expect(main.nodes[0]?.id).toBe("main.nf#/:params");
  });

  it("F-106 LA-26: the output node has one input per declared output, fed by publish; undeclared targets add ports", async () => {
    const main = must(projector, "main.nf", null);
    const out = node(main, "main.nf#/:output");
    expect(out.kind).toBe("output");
    expect(out.outputs).toEqual([]);
    expect(main.nodes.at(-1)?.id).toBe("main.nf#/:output");
    expect(ports(out, "inputs")).toEqual(["bams", "report", "upper"]);
    expect(out.inputs[0]?.type).toMatchObject({ dataflow: "channel" });
    expect(out.inputs[1]?.type).toMatchObject({ dataflow: "plain" });
    expect(into(main, out.id, "bams")).toMatchObject([
      {
        from: { node: "main.nf#/prepared", port: "bams" },
        variable: "prepared.bams",
        direct: true,
      },
    ]);
    expect(into(main, out.id, "report")).toMatchObject([
      { from: { node: "main.nf#/report", port: "report" }, variable: "report" },
    ]);
    expect(into(main, out.id, "upper")).toMatchObject([
      { from: { node: "main.nf#/sub", port: "upper" } },
    ]);
    const p = must(
      await projectorForFiles({
        // deliberately not lint-clean: `extra` and `inline` are published but not declared in the output block
        "main.nf":
          "nextflow.enable.types = true\n\nworkflow {\n    main:\n    x = channel.of(1)\n\n    publish:\n    extra = x\n    inline = 'a'\n}\n\noutput {\n    declared: Channel<Integer> {\n        path 'd'\n    }\n}\n",
      }),
      "main.nf",
      null,
    );
    const o = node(p, "main.nf#/:output");
    expect(ports(o, "inputs")).toEqual(["declared", "extra", "inline"]);
    expect(o.inputs[0]?.argument).toBeNull();
    expect(into(p, o.id, "extra")).toMatchObject([
      { from: { node: "main.nf#/x", port: "out" } },
    ]);
    expect(o.inputs[2]?.argumentType).toMatchObject({ dataflow: "plain" });
    expect(into(p, o.id, "inline")).toEqual([]);
  });

  it("F-106 LA-28: a process or agent call returns Channel when any argument is a channel or unknown, else Value", async () => {
    const main = must(projector, "main.nf", null);
    expect(type(node(main, "main.nf#/answers"), "out")).toBe("Channel<String>");
    expect(type(node(main, "main.nf#/single"), "out")).toBe("Value<String>");
    const single = node(main, "main.nf#/single");
    expect(single.inputs[0]).toMatchObject({ id: "question" });
    expect(single.inputs[0]?.argumentType).toEqual({
      dataflow: "plain",
      element: { name: "String", args: [], nullable: false },
    });
    expect(single.inputs[0]?.argument).not.toBeNull();
    expect(into(main, single.id, "question")).toEqual([]);
    const p = must(
      await projectorForFiles({
        "a.nf":
          "nextflow.enable.types = true\n\nprocess P {\n    input:\n    x: String\n\n    output:\n    y: String = x\n\n    script:\n    'x'\n}\n",
        "main.nf":
          "include { P } from './a'\n\nworkflow {\n    a = P(null)\n    b = P(unknown)\n    c = P(channel.of('x'))\n    d = P(null + 1)\n}\n",
      }),
      "main.nf",
      null,
    );
    expect(type(node(p, "main.nf#/a"), "y")).toBe("Value<String>");
    expect(type(node(p, "main.nf#/b"), "y")).toBe("Channel<String>");
    expect(type(node(p, "main.nf#/c"), "y")).toBe("Channel<String>");
    expect(type(node(p, "main.nf#/d"), "y")).toBe("Channel<String>");
  });

  it("F-106 LA-28: every edge carries its source port's type", () => {
    for (const ref of projector.workflows()) {
      const p = projector.project(ref.path, ref.name);
      if (p === null) continue;
      for (const edge of p.edges) {
        const from = node(p, edge.from.node).outputs.find(
          (o) => o.id === edge.from.port,
        );
        expect(edge.type, edge.id).toEqual(
          from?.type ?? { dataflow: null, element: null },
        );
        expect(
          node(p, edge.to.node).inputs.some((i) => i.id === edge.to.port),
          edge.id,
        ).toBe(true);
      }
    }
  });

  it("F-106 AR-10: def-use edges read the latest assignment before the use; res.name reads that output; a nested call is its own node", async () => {
    const p = must(
      await projectorForFiles({
        "m.nf":
          "nextflow.enable.types = true\n\nprocess P {\n    input:\n    x: Path\n\n    output:\n    a: Path = x\n\n    script:\n    'x'\n}\n\nprocess R {\n    input:\n    x: Path\n\n    output:\n    a: Path = x\n    b: Path = x\n\n    script:\n    'x'\n}\n",
        "main.nf":
          "nextflow.enable.types = true\n\ninclude { P ; R } from './m'\n\nworkflow W {\n    take:\n    src: Channel<Path>\n\n    main:\n    v = src\n    v = P(v)\n    w = R(v)\n    z = P(P(w.b))\n}\n",
      }),
      "main.nf",
      "W",
    );
    // F-107 AR-10: v = src is an alias of a graph value: it creates no node, so the first call assigned to v is keyed v
    expect(node(p, "main.nf#W/v").kind).toBe("call");
    expect(p.nodes.some((n) => n.id === "main.nf#W/v~2")).toBe(false);
    expect(into(p, "main.nf#W/v", "x")).toMatchObject([
      { from: { node: "main.nf#W/:take:src" }, variable: "v" },
    ]);
    // the use after the reassignment reads the latest assignment
    expect(into(p, "main.nf#W/w", "x")).toMatchObject([
      {
        from: { node: "main.nf#W/v", port: "a" },
        variable: "v",
        direct: true,
      },
    ]);
    // a nested call is its own node, created before the call using it
    expect(into(p, "main.nf#W/z", "x")).toMatchObject([
      {
        from: { node: "main.nf#W/P@1", port: "a" },
        variable: null,
        direct: true,
      },
    ]);
    expect(into(p, "main.nf#W/P@1", "x")).toMatchObject([
      {
        from: { node: "main.nf#W/w", port: "b" },
        variable: "w.b",
        direct: true,
      },
    ]);
    const order = p.nodes.map((n) => n.id);
    expect(order.indexOf("main.nf#W/P@1")).toBeLessThan(
      order.indexOf("main.nf#W/z"),
    );
  });

  it("F-106 AR-10: using a multi-output nested call as a whole gives one indirect edge per output port", async () => {
    const p = must(
      await projectorForFiles({
        // deliberately not lint-clean: a record passed to a Path input shows the per-output fan-in
        "m.nf":
          "nextflow.enable.types = true\n\nprocess R {\n    input:\n    x: Path\n\n    output:\n    a: Path = x\n    b: Path = x\n\n    script:\n    'x'\n}\n",
        "main.nf":
          "nextflow.enable.types = true\n\ninclude { R } from './m'\n\nworkflow W {\n    take:\n    src: Channel<Path>\n\n    main:\n    z = R(R(src))\n}\n",
      }),
      "main.nf",
      "W",
    );
    expect(into(p, "main.nf#W/z", "x")).toMatchObject([
      { from: { node: "main.nf#W/R@1", port: "a" }, direct: false },
      { from: { node: "main.nf#W/R@1", port: "b" }, direct: false },
    ]);
  });

  it("F-106 AR-10: a pipeline call takes the included pipeline's params and gives its outputs; record() arguments map to params", async () => {
    const main = must(projector, "main.nf", null);
    const sub = node(main, "main.nf#/sub") as CallNode;
    expect(sub.callee).toMatchObject({
      name: "SUB",
      kind: "pipeline",
      status: "modelled",
      path: "pipelines/sub.nf",
    });
    expect(ports(sub, "inputs")).toEqual(["input"]);
    expect(sub.inputs[0]?.type).toMatchObject({ dataflow: "channel" });
    expect(ports(sub, "outputs")).toEqual(["upper"]);
    expect(type(sub, "upper")).toBe("Channel<String>");
    expect(into(main, sub.id, "input")).toMatchObject([
      {
        from: { node: "main.nf#/ch_names~2", port: "out" },
        variable: "ch_names",
        direct: true,
      },
    ]);
    const p = must(
      await projectorForFiles({
        // deliberately not lint-clean: the extra record key `c` and the bare `SUB(s)` exercise the pipeline port rules
        "sub.nf":
          "nextflow.enable.types = true\n\nparams {\n    a: String\n    b: Integer\n}\n\nworkflow {\n    main:\n    x = channel.of(params.a)\n\n    publish:\n    x = x\n}\n\noutput {\n    x: Channel<String> {\n        path 'x'\n    }\n}\n",
        "main.nf":
          "nextflow.enable.types = true\n\ninclude { workflow as SUB } from './sub'\n\nworkflow {\n    main:\n    s = channel.of('q')\n    r = SUB(record(a: s.map { v -> v }, b: 3, c: s))\n    t = SUB(s)\n}\n",
      }),
      "main.nf",
      null,
    );
    const r = node(p, "main.nf#/r");
    expect(ports(r, "inputs")).toEqual(["a", "b", "c"]);
    expect(into(p, r.id, "a")).toMatchObject([
      { from: { node: "main.nf#/.map@1", port: "out" }, direct: true },
    ]);
    expect(r.inputs[1]?.argumentType).toMatchObject({ dataflow: "plain" });
    expect(into(p, r.id, "c")).toMatchObject([
      { from: { node: "main.nf#/s", port: "out" }, variable: "s" },
    ]);
    // any other argument shape feeds one $1 port
    const t = node(p, "main.nf#/t");
    expect(ports(t, "inputs")).toEqual(["$1"]);
    expect(ports(t, "outputs")).toEqual(["x"]);
    expect(into(p, t.id, "$1")).toMatchObject([
      { from: { node: "main.nf#/s", port: "out" } },
    ]);
  });

  it("F-106 LA-14 F-107 LA-21: a typed workflow's call to a legacy process is a call node with its qualifier ports", () => {
    const main = must(projector, "main.nf", null);
    const counts = node(main, "main.nf#/counts") as CallNode;
    expect(counts.callee).toMatchObject({
      name: "LEGACY_COUNT",
      kind: "process",
      typed: false,
    });
    // F-107 LA-21: the ports come from the qualifiers, and the result kind from the arguments
    expect(ports(counts, "inputs")).toEqual(["reads"]);
    expect(ports(counts, "outputs")).toEqual(["txt"]);
    expect(type(counts, "txt")).toBe("Channel<Path>");
    expect(into(main, counts.id, "reads")).toMatchObject([
      { from: { node: "main.nf#/prepared", port: "bams" } },
    ]);
  });

  it("F-106 AR-10 ADR-0004: functions, plugin entries and unknown names are not call nodes; statements that aren't dataflow are code nodes", async () => {
    const p = must(
      await projectorForFiles({
        "main.nf":
          "include { thing } from 'plugin/nf-x'\n\ndef helper() {\n    return 1\n}\n\nworkflow {\n    log.info 'a'\n    helper()\n    thing()\n    nothing()\n    x = helper()\n    if (x) {\n        println x\n    }\n}\n",
      }),
      "main.nf",
      null,
    );
    expect(p.nodes.map((n) => [n.id, n.kind])).toEqual([
      ["main.nf#/:code@1", "code"],
      ["main.nf#/:code@2", "code"],
      ["main.nf#/:code@3", "code"],
      ["main.nf#/:code@4", "code"],
      ["main.nf#/x", "code"],
      ["main.nf#/:code@5", "code"],
    ]);
    expect(node(p, "main.nf#/x").outputs.map((o) => o.id)).toEqual(["x"]);
    expect(node(p, "main.nf#/:code@1").inputs).toEqual([]);
  });

  it("F-106 AR-12 LA-24: a chain on a property of a branch or multiMap result is still a chain, with an indirect edge from the whole result", async () => {
    const p = must(
      await projectorForFiles({
        "main.nf":
          "nextflow.enable.types = true\n\nworkflow {\n    main:\n    ch = channel.fromPath('x')\n    split = ch.branch { v ->\n        small: v.size() < 10\n        large: v\n    }\n    split.small.view()\n    up = split.large.map { v -> v }\n}\n",
      }),
      "main.nf",
      null,
    );
    expect(p.nodes.map((n) => [n.id, n.kind])).toEqual([
      ["main.nf#/ch", "factory"],
      ["main.nf#/split", "chain"],
      ["main.nf#/.view@1", "chain"],
      ["main.nf#/up", "chain"],
    ]);
    for (const id of ["main.nf#/.view@1", "main.nf#/up"])
      expect(into(p, id, "in")).toMatchObject([
        {
          from: { node: "main.nf#/split", port: "out" },
          variable: "split",
          direct: false,
        },
      ]);
  });

  it("F-106 AR-10: a call nested under a property in an argument or a chain is its own node, and the property is its output port", async () => {
    const p = must(
      await projectorForFiles({
        "main.nf":
          "nextflow.enable.types = true\n\nprocess MULTI {\n    input:\n    a: Path\n    b: Path\n\n    output:\n    txt: Path = file('t.txt')\n    html: Path = file('h.html')\n\n    script:\n    'x'\n}\n\nprocess ONE {\n    input:\n    v: Path\n\n    output:\n    out: Path = file('o')\n\n    script:\n    'x'\n}\n\nworkflow {\n    main:\n    ch = channel.fromPath('x')\n    one = ONE(MULTI(ch, file('x')).txt)\n    two = MULTI(ch, file('y')).html.collect()\n}\n",
      }),
      "main.nf",
      null,
    );
    expect(into(p, "main.nf#/one", "v")).toMatchObject([
      {
        from: { node: "main.nf#/MULTI@1", port: "txt" },
        variable: null,
        direct: true,
      },
    ]);
    expect(into(p, "main.nf#/MULTI@1", "a")).toMatchObject([
      { from: { node: "main.nf#/ch", port: "out" }, variable: "ch" },
    ]);
    expect(node(p, "main.nf#/two").kind).toBe("chain");
    expect(into(p, "main.nf#/two", "in")).toMatchObject([
      {
        from: { node: "main.nf#/MULTI@2", port: "html" },
        variable: null,
        direct: true,
      },
    ]);
    // as nextflow lint infers it
    expect(type(node(p, "main.nf#/two"), "out")).toBe("Value<Bag<Path>>");
  });

  it("F-106 LA-28 F-107 AR-10: a copy of a graph value is an alias that carries its type", async () => {
    const p = must(
      await projectorForFiles({
        "main.nf":
          "nextflow.enable.types = true\n\nparams {\n    names: List<String> = ['a']\n}\n\nworkflow {\n    main:\n    ch = channel.fromPath('x')\n    names = params.names\n    w = ch\n    w2 = w\n    w2.view()\n    names.size()\n}\n",
      }),
      "main.nf",
      null,
    );
    expect(p.nodes.map((n) => n.id)).toEqual([
      "main.nf#/:params",
      "main.nf#/ch",
      "main.nf#/.view@1",
      "main.nf#/:code@1",
    ]);
    expect(p.edges.find((e) => e.to.node === "main.nf#/.view@1")).toMatchObject(
      {
        from: { node: "main.nf#/ch", port: "out" },
        variable: "w2",
      },
    );
    expect(
      formatFlowType(
        p.edges.find((e) => e.to.node === "main.nf#/.view@1")?.type as never,
      ),
    ).toBe("Channel<Path>");
  });

  it("F-106 ADR-0004: calls to an Unparsed declaration or to an include with a missing target are call nodes marked unparsed or unresolved", async () => {
    const p = must(
      await projectorForFiles({
        "broken.nf":
          "process BROKEN {\n    input\n    script:\n}\n\nworkflow OK {\n}\n",
        "main.nf":
          "include { BROKEN } from './broken'\ninclude { GONE } from './gone'\n\nworkflow {\n    a = BROKEN(1, 2)\n    b = GONE(a)\n}\n",
      }),
      "main.nf",
      null,
    );
    expect((node(p, "main.nf#/a") as CallNode).callee).toMatchObject({
      name: "BROKEN",
      status: "unparsed",
    });
    expect((node(p, "main.nf#/b") as CallNode).callee).toMatchObject({
      name: "GONE",
      status: "unresolved",
    });
    expect(ports(node(p, "main.nf#/a"), "inputs")).toEqual(["$1", "$2"]);
  });

  it("F-106 LA-26: the output block feeds only the entry workflow's output node; a named workflow has none (publish is entry-only)", async () => {
    const p = await projectorForFiles({
      // deliberately not lint-clean: the output block has no publish section to declare outputs for
      "main.nf":
        "nextflow.enable.types = true\n\nworkflow PLAIN {\n    main:\n    x = channel.of(1)\n}\n\nworkflow {\n    main:\n    y = channel.of(1)\n}\n\noutput {\n    x: Channel<Integer> {\n        path 'x'\n    }\n}\n",
    });
    const kinds = (name: string | null) =>
      must(p, "main.nf", name).nodes.map((n) => n.kind);
    expect(kinds("PLAIN")).not.toContain("output");
    expect(kinds(null)).toContain("output");
  });

  it("F-106 AR-10 ADR-0004 F-107: every main statement is listed once, with nodes it created, a name it bound, or one code node; every emit an emit node, every publish item an edge or port of the output node", () => {
    for (const ref of projector.workflows()) {
      const p = projector.project(ref.path, ref.name);
      if (p === null) continue;
      const file = model.file(ref.path)?.source;
      const ast = file?.language === "nextflow" ? file.ast : null;
      const def = ast?.body.find(
        (i) => i.kind === "Workflow" && (i.name?.name ?? null) === ref.name,
      );
      if (def?.kind !== "Workflow") continue;
      const body = def.main?.items.filter((s) => s.kind !== "EmptyStatement");
      expect(p.statements.map((s) => s.range.start)).toEqual(
        (body ?? []).map((s) => s.range.start),
      );
      for (const statement of p.statements) {
        const codes = statement.nodes.filter(
          (id) => p.nodes.find((n) => n.id === id)?.kind === "code",
        );
        expect(
          statement.nodes.length + statement.binds.length,
          `${ref.path}:${statement.range.line}`,
        ).toBeGreaterThan(0);
        expect(codes.length).toBeLessThanOrEqual(1);
        expect(statement.modelled).toBe(codes.length === 0);
      }
      const emits = def.emits?.items.length ?? 0;
      expect(p.nodes.filter((n) => n.kind === "emit")).toHaveLength(emits);
      for (const item of def.publishers?.items ?? []) {
        const output = p.nodes.find((n) => n.kind === "output");
        expect(
          output?.inputs.some((i) => i.id === item.name.name),
          item.name.name,
        ).toBe(true);
      }
    }
  });

  it("F-106 LA-22 IO-14: a workflow whose emit types depend on each other in a cycle gives unknown types, whichever is projected first", async () => {
    const files = {
      "a.nf":
        "include { B } from './b'\n\nworkflow A {\n    take:\n    x\n\n    main:\n    r = B(x)\n\n    emit:\n    r\n}\n",
      "b.nf":
        "include { A } from './a'\n\nworkflow B {\n    take:\n    x\n\n    main:\n    r = A(x)\n\n    emit:\n    r\n}\n",
    };
    const first = await projectorForFiles(files);
    const second = await projectorForFiles(files);
    const a1 = must(first, "a.nf", "A");
    const b1 = must(first, "b.nf", "B");
    const b2 = must(second, "b.nf", "B");
    const a2 = must(second, "a.nf", "A");
    expect(b1).toEqual(b2);
    expect(a1).toEqual(a2);
    const call = node(a1, "a.nf#A/r");
    expect(call.outputs[0]?.type).toEqual({ dataflow: null, element: null });
  });

  it("F-106 AR-31: projections are plain data and deterministic", async () => {
    const p = must(projector, "main.nf", null);
    expect(structuredClone(p)).toEqual(p);
    const again = must(await projectorFor(model), "main.nf", null);
    expect(again).toEqual(p);
  });

  it("F-106 AR-11: node ids are unique across every workflow of a project", () => {
    const seen = new Set<string>();
    for (const ref of projector.workflows()) {
      const p = projector.project(ref.path, ref.name);
      if (p === null) continue;
      for (const n of p.nodes) {
        expect(seen.has(n.id), n.id).toBe(false);
        seen.add(n.id);
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it("F-106: workflows() lists modelled and unparsed workflows; project() returns null for an unparsed or missing one", async () => {
    const q = await projectorForFiles({
      "a.nf":
        "workflow W {\n    take:\n    x\n\n    main:\n    y = x\n}\n\nworkflow BAD {\n    main:\n    @@@\n}\n",
      "b.nf": "x = channel.of(1)\nx.view()\n",
    });
    const refs = q.workflows().map((r) => [r.path, r.name, r.modelled]);
    expect(refs).toEqual([
      ["a.nf", "W", true],
      ["a.nf", "BAD", false],
      ["b.nf", null, true],
    ]);
    expect(q.project("a.nf", "BAD")).toBeNull();
    expect(q.project("a.nf", "NOPE")).toBeNull();
    expect(q.project("zzz.nf", null)).toBeNull();
    const script = must(q, "b.nf", null);
    expect(script.nodes.map((n) => n.id)).toEqual(["b.nf#/x", "b.nf#/.view@1"]);
  });

  it("F-106 IO-14: projecting never throws", async () => {
    const q = await projectorForFiles({
      "empty.nf": "workflow {\n}\n",
      "verbatim.nf": "@@@ not nextflow at all {{{",
      "self.nf": "workflow R {\n    main:\n    x = R(1)\n}\n",
      "a.nf":
        "include { B } from './b'\n\nworkflow A {\n    main:\n    x = B(1)\n}\n",
      "b.nf":
        "include { A } from './a'\n\nworkflow B {\n    main:\n    x = A(1)\n}\n",
      "notes.md": "# hello\n",
    });
    for (const ref of q.workflows())
      expect(() => q.project(ref.path, ref.name)).not.toThrow();
    expect(q.project("verbatim.nf", null)).toBeNull();
    expect(must(q, "empty.nf", null).nodes).toEqual([]);
    expect(q.project("notes.md", null)).toBeNull();
  });
});
