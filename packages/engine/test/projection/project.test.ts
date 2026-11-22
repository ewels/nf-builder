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
          "nextflow.enable.types = true\n\nprocess P {\n    input:\n    x: Path\n\n    output:\n    a: Path = x\n    b: Path = x\n\n    script:\n    'x'\n}\n",
        "main.nf":
          "nextflow.enable.types = true\n\ninclude { P } from './m'\n\nworkflow W {\n    take:\n    src: Channel<Path>\n\n    main:\n    v = src\n    v = P(v)\n    w = P(v.a)\n    z = P(P(w.b))\n}\n",
      }),
      "main.nf",
      "W",
    );
    // v = src is a bare variable, not a dataflow expression: a code node binding v
    expect(node(p, "main.nf#W/v").kind).toBe("code");
    expect(node(p, "main.nf#W/v~2").kind).toBe("call");
    expect(into(p, "main.nf#W/v~2", "x")[0]?.from.node).toBe("main.nf#W/v");
    expect(into(p, "main.nf#W/w", "x")).toMatchObject([
      {
        from: { node: "main.nf#W/v~2", port: "a" },
        variable: "v.a",
        direct: true,
      },
    ]);
    // a nested call is its own node; its two outputs feed the argument, indirectly
    expect(into(p, "main.nf#W/z", "x")).toMatchObject([
      {
        from: { node: "main.nf#W/P@1", port: "a" },
        variable: null,
        direct: false,
      },
      {
        from: { node: "main.nf#W/P@1", port: "b" },
        variable: null,
        direct: false,
      },
    ]);
    expect(into(p, "main.nf#W/P@1", "x")).toMatchObject([
      { from: { node: "main.nf#W/w", port: "b" }, variable: "w.b" },
    ]);
    const order = p.nodes.map((n) => n.id);
    expect(order.indexOf("main.nf#W/P@1")).toBeLessThan(
      order.indexOf("main.nf#W/z"),
    );
  });

  it("F-106 AR-10: an argument that only reads a graph value inside an expression is an indirect edge", () => {
    const main = must(projector, "main.nf", null);
    const sub = node(main, "main.nf#/sub") as CallNode;
    expect(sub.callee).toMatchObject({
      name: "SUB",
      kind: "pipeline",
      status: "modelled",
    });
    expect(into(main, sub.id, "$1")).toMatchObject([
      {
        from: { node: "main.nf#/ch_names~2", port: "out" },
        variable: "ch_names",
        direct: false,
      },
    ]);
  });

  it("F-106 LA-14: a typed workflow's call to a legacy process is a call node with argument ports", () => {
    const main = must(projector, "main.nf", null);
    const counts = node(main, "main.nf#/counts") as CallNode;
    expect(counts.callee).toMatchObject({
      name: "LEGACY_COUNT",
      kind: "process",
      typed: false,
    });
    expect(ports(counts, "inputs")).toEqual(["$1"]);
    expect(ports(counts, "outputs")).toEqual(["out"]);
    expect(type(counts, "out")).toBe("-");
    expect(into(main, counts.id, "$1")).toMatchObject([
      { from: { node: "main.nf#/prepared", port: "bams" } },
    ]);
  });

  it("F-106 AR-10 ADR-0004: functions, plugin entries and unknown names are not call nodes; statements that aren't dataflow are code nodes", async () => {
    const p = must(
      await projectorForFiles({
        "main.nf":
          "include { thing } from 'plugin/nf-x'\n\nfunction helper() {\n    return 1\n}\n\nworkflow {\n    log.info 'a'\n    helper()\n    thing()\n    nothing()\n    x = helper()\n    if (x) {\n        println x\n    }\n}\n",
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
