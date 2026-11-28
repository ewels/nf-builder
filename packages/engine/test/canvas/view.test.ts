import type {
  Callee,
  FlowType,
  GraphEdge,
  GraphNode,
  Port,
  Projection,
  WorkflowRef,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { CANVAS_METRICS, canvasView, nodeTitle } from "../../src/canvas";

const range = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const ref: WorkflowRef = {
  path: "main.nf",
  name: null,
  modelled: true,
  typed: true,
  range,
};
const flow = (
  dataflow: FlowType["dataflow"],
  name: string | null = "Path",
): FlowType => ({
  dataflow,
  element: name === null ? null : { name, args: [], nullable: false },
});
const port = (id: string, type: FlowType | null = null): Port => ({
  id,
  label: id,
  type,
  argument: null,
  argumentType: null,
});
const base = (id: string, label: string, inputs: Port[], outputs: Port[]) => ({
  id,
  label,
  inputs,
  outputs,
  range,
  guards: [],
});
const callee = (over: Partial<Callee> = {}): Callee => ({
  name: "P",
  kind: "process",
  status: "modelled",
  typed: false,
  path: "p.nf",
  module: null,
  ...over,
});
const call = (id: string, c: Partial<Callee>, inputs = 1, outputs = 1) =>
  ({
    ...base(
      id,
      c.name ?? "P",
      Array.from({ length: inputs }, (_, i) => port(`in${i}`)),
      Array.from({ length: outputs }, (_, i) => port(`out${i}`)),
    ),
    kind: "call",
    callee: callee(c),
  }) as GraphNode;
const projection = (
  nodes: GraphNode[],
  edges: GraphEdge[] = [],
): Projection => ({ workflow: ref, nodes, edges, statements: [] });
const edge = (
  from: [string, string],
  to: [string, string],
  type: FlowType,
  variable: string | null,
): GraphEdge => ({
  id: `${from[0]}[${from[1]}] -> ${to[0]}[${to[1]}]`,
  from: { node: from[0], port: from[1] },
  to: { node: to[0], port: to[1] },
  type,
  variable,
  direct: true,
});
const one = (n: GraphNode, portLabels = true) => {
  const node = canvasView(projection([n]), { portLabels }).nodes[0];
  if (node === undefined) throw new Error("no node");
  return node;
};

describe("F-205 canvas view", () => {
  it("F-205 UX-21 UX-22: each node kind and callee variant maps to its appearance, shape, title and subtitle", () => {
    const rows: [GraphNode, string, string, string, string | null][] = [
      [call("a", { kind: "process" }), "process", "card", "P", "process"],
      [call("a", { kind: "agent" }), "agent", "card", "P", "agent"],
      [call("a", { kind: "workflow" }), "workflow", "card", "P", "workflow"],
      [call("a", { kind: "pipeline" }), "workflow", "card", "P", "pipeline"],
      [
        {
          ...base("c", ".flatMap.collect", [port("in")], [port("out")]),
          kind: "chain",
          steps: [
            { operator: "flatMap", range, known: true },
            { operator: "collect", range, known: true },
          ],
        },
        "chain",
        "pill",
        "flatMap → collect",
        null,
      ],
      [
        {
          ...base("f", "channel.of", [], [port("out")]),
          kind: "factory",
          namespace: "channel",
          factory: "of",
        },
        "factory",
        "card",
        "channel.of",
        "channel factory",
      ],
      [
        { ...base("p", "params", [], [port("x")]), kind: "params" },
        "params",
        "card",
        "params",
        "pipeline inputs",
      ],
      [
        { ...base("o", "output", [port("x")], []), kind: "output" },
        "output",
        "card",
        "output",
        "publish",
      ],
      [
        {
          ...base("t", "reads", [], [port("out")]),
          kind: "take",
          name: "reads",
        },
        "take",
        "pill",
        "reads",
        "take",
      ],
      [
        { ...base("e", "bam", [port("in")], []), kind: "emit", name: "bam" },
        "emit",
        "pill",
        "bam",
        "emit",
      ],
      [
        {
          ...base("k", "log.info 'x'", [], []),
          kind: "code",
          text: "log.info 'x'\nmore",
        },
        "code",
        "card",
        "log.info 'x'",
        "code",
      ],
    ];
    for (const [node, appearance, shape, title, subtitle] of rows) {
      const v = one(node);
      expect([v.appearance, v.shape, v.title, v.subtitle], node.kind).toEqual([
        appearance,
        shape,
        title,
        subtitle,
      ]);
      expect(v.kind).toBe(node.kind);
    }
  });

  it("F-307 UX-22 UX-50: opens is true for resolved workflow and pipeline calls only", () => {
    const rows: [Partial<Callee>, boolean][] = [
      [{ kind: "workflow" }, true],
      [{ kind: "pipeline" }, true],
      [{ kind: "process" }, false],
      [{ kind: "agent" }, false],
      [{ kind: "workflow", status: "unparsed" }, false],
      [{ kind: "workflow", status: "unresolved", path: null }, false],
    ];
    for (const [c, opens] of rows)
      expect(one(call("a", c)).opens, JSON.stringify(c)).toBe(opens);
    const factory = {
      ...base("f", "channel.of", [], [port("out")]),
      kind: "factory",
      namespace: "channel",
      factory: "of",
    } as GraphNode;
    expect(one(factory).opens).toBe(false);
  });

  it("F-205 UX-22: a registry callee's subtitle is its module name", () => {
    const v = one(call("a", { module: "nf-core/fastqc" }));
    expect([v.appearance, v.subtitle]).toEqual(["module", "nf-core/fastqc"]);
    const w = one(call("a", { kind: "workflow", module: "nf-core/sub" }));
    expect([w.appearance, w.subtitle]).toEqual(["workflow", "nf-core/sub"]);
  });

  it("F-205 UX-22: unparsed and unresolved callees draw as unparsed, subtitled 'could not be parsed' and 'not found'", () => {
    const u = one(call("a", { status: "unparsed", typed: null }));
    expect([u.appearance, u.subtitle]).toEqual([
      "unparsed",
      "could not be parsed",
    ]);
    const r = one(call("a", { status: "unresolved", kind: null, typed: null }));
    expect([r.appearance, r.subtitle]).toEqual(["unparsed", "not found"]);
  });

  it("F-205 UX-23 ADR-0007: only a call whose callee is typed carries the typed badge", () => {
    expect(one(call("a", { typed: true })).badge).toBe("typed");
    expect(one(call("a", { typed: true, kind: "workflow" })).badge).toBe(
      "typed",
    );
    expect(one(call("a", { typed: false })).badge).toBeNull();
    expect(one(call("a", { typed: null })).badge).toBeNull();
    expect(
      one({ ...base("p", "params", [], []), kind: "params" }).badge,
    ).toBeNull();
  });

  it("F-205 UX-22 ADR-0008: a chain's title lists its operators joined by arrows", () => {
    const v = one({
      ...base("c", ".map.collect", [port("in")], [port("out")]),
      kind: "chain",
      steps: [
        { operator: "map", range, known: true },
        { operator: "collect", range, known: true },
      ],
    });
    expect(v.title).toBe("map → collect");
  });

  it("F-205 UX-21: a take or emit pill is wide enough for its prefix as well as its name", () => {
    const m = CANVAS_METRICS;
    const take = one({
      ...base("t", "read_pairs_ch", [], [port("out")]),
      kind: "take",
      name: "read_pairs_ch",
    });
    const chain = one({
      ...base("c", ".map", [port("in")], [port("out")]),
      kind: "chain",
      steps: [{ operator: "map", range, known: true }],
    });
    expect(m.pillPrefixWidth).toBeGreaterThan(0);
    expect(take.width).toBe(
      "read_pairs_ch".length * m.pillCharWidth +
        m.pillPadding +
        m.pillPrefixWidth,
    );
    expect(chain.width).toBe(m.pillMinWidth);
    const long = one({
      ...base("e", "x", [port("in")], []),
      kind: "emit",
      name: "x".repeat(100),
    });
    expect(long.width).toBe(m.pillMaxWidth);
  });

  it("F-205 UX-24 LA-28: edge dataflow comes from the type; null is unknown", () => {
    const nodes = [call("a", {}), call("b", {})];
    const types: [FlowType, string][] = [
      [flow("channel"), "channel"],
      [flow("value"), "value"],
      [flow("plain"), "plain"],
      [flow(null, null), "unknown"],
    ];
    for (const [type, expected] of types) {
      const v = canvasView(
        projection(nodes, [edge(["a", "out0"], ["b", "in0"], type, "x")]),
        { portLabels: true },
      );
      expect(v.edges[0]?.dataflow).toBe(expected);
    }
  });

  it("F-205 UX-24: the tooltip is the formatted type and the variable, or the source node and port", () => {
    const nodes = [call("a", { name: "SRC" }), call("b", {})];
    const tip = (type: FlowType, variable: string | null) =>
      canvasView(
        projection(nodes, [edge(["a", "out0"], ["b", "in0"], type, variable)]),
        { portLabels: true },
      ).edges[0]?.tooltip;
    expect(tip(flow("value"), "params.fasta")).toBe(
      "Value<Path> · params.fasta",
    );
    expect(tip(flow("channel"), "ch")).toBe("Channel<Path> · ch");
    expect(tip(flow("plain"), null)).toBe("Path · SRC out0");
    expect(tip(flow(null, null), null)).toBe("Unknown type · SRC out0");
  });

  it("F-205 UX-21: without port labels every port is kept and nodes are shorter", () => {
    const n = call("a", {}, 3, 2);
    const on = one(n, true);
    const off = one(n, false);
    expect(off.inputs).toEqual(on.inputs);
    expect(off.outputs).toEqual(on.outputs);
    expect(on.inputs.map((p) => p.id)).toEqual(["in0", "in1", "in2"]);
    expect(off.rowHeight).toBeLessThan(on.rowHeight);
    expect(off.height).toBeLessThan(on.height);
    expect(off.width).toBe(on.width);
  });

  it("F-205 UX-21: port types are formatted, null when unknown, and the aria label counts ports", () => {
    const n = {
      ...base("a", "P", [port("i", flow("channel"))], [port("o")]),
      kind: "call",
      callee: callee({ typed: true }),
    } as GraphNode;
    const v = one(n);
    expect(v.inputs[0]?.type).toBe("Channel<Path>");
    expect(v.outputs[0]?.type).toBeNull();
    expect(v.ariaLabel).toBe("P, process, typed, 1 input, 1 output");
  });

  it("F-205 AR-11 AR-31: view ids are projection keys, edges reference existing ports, and the view survives structuredClone", () => {
    const nodes = [call("a", {}, 1, 1), call("b", {}, 1, 1)];
    const p = projection(nodes, [
      edge(["a", "out0"], ["b", "in0"], flow("channel"), "x"),
    ]);
    const v = canvasView(p, { portLabels: true });
    expect(v.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    for (const e of v.edges) {
      const s = v.nodes.find((n) => n.id === e.source);
      const t = v.nodes.find((n) => n.id === e.target);
      expect(s?.outputs.map((x) => x.id)).toContain(e.sourcePort);
      expect(t?.inputs.map((x) => x.id)).toContain(e.targetPort);
    }
    expect(structuredClone(v)).toEqual(v);
  });

  it("F-206 F-205: nodeTitle equals each canvas node's title", () => {
    const nodes: GraphNode[] = [
      call("a", { name: "ALIGN" }),
      call("u", { status: "unparsed" }),
      {
        ...base("c", ".map.collect", [port("in")], [port("out")]),
        kind: "chain",
        steps: [
          { operator: "map", range, known: true },
          { operator: "collect", range, known: true },
        ],
      },
      { ...base("p", "params", [], [port("x")]), kind: "params" },
      { ...base("o", "output", [port("x")], []), kind: "output" },
      { ...base("t", "reads", [], [port("out")]), kind: "take", name: "reads" },
      {
        ...base("k", "log.info 'x'", [], []),
        kind: "code",
        text: "log.info 'x'",
      },
    ];
    const view = canvasView(projection(nodes), { portLabels: true });
    for (const node of nodes)
      expect(nodeTitle(node), node.id).toBe(
        view.nodes.find((n) => n.id === node.id)?.title,
      );
  });
});
