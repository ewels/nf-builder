import type { GraphNode } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { nodeView } from "../../src/details/node-view";
import {
  base,
  call,
  edge,
  flow,
  port,
  projection,
  range,
  workflowRef,
} from "./helpers";

const view = (n: GraphNode) => {
  const v = nodeView(projection([n]), n.id);
  if (v === null) throw new Error("no view");
  return v;
};

describe("F-206 node view", () => {
  it("F-206 UX-30: every node kind and callee variant has its name, kind label and file", () => {
    const rows: [GraphNode, string, string, string | null, number | null][] = [
      [
        call("a", { kind: "process", typed: true }),
        "P",
        "Typed process",
        "p.nf",
        null,
      ],
      [
        call("a", { kind: "process", typed: false }),
        "P",
        "Legacy process",
        "p.nf",
        null,
      ],
      [call("a", { kind: "agent", typed: true }), "P", "Agent", "p.nf", null],
      [
        call("a", { kind: "workflow", typed: true }),
        "P",
        "Typed workflow",
        "p.nf",
        null,
      ],
      [
        call("a", { kind: "workflow", typed: false }),
        "P",
        "Legacy workflow",
        "p.nf",
        null,
      ],
      [call("a", { kind: "pipeline" }), "P", "Pipeline", "p.nf", null],
      [
        call("a", { module: "nf-core/fastqc" }),
        "P",
        "Legacy process · registry module nf-core/fastqc",
        "p.nf",
        null,
      ],
      [
        call("a", { status: "unparsed", typed: null }),
        "P",
        "Process (could not be parsed)",
        "p.nf",
        null,
      ],
      [
        call("a", { status: "unparsed", kind: null, typed: null }),
        "P",
        "Declaration (could not be parsed)",
        "p.nf",
        null,
      ],
      [
        call("a", {
          status: "unresolved",
          kind: null,
          typed: null,
          path: null,
        }),
        "P",
        "Unresolved call",
        null,
        null,
      ],
      [
        {
          ...base("c", ".flatMap.collect", [port("in")], [port("out")]),
          kind: "chain",
          steps: [
            { operator: "flatMap", range, known: true },
            { operator: "collect", range, known: true },
          ],
        },
        "flatMap → collect",
        "Operator chain",
        "main.nf",
        7,
      ],
      [
        {
          ...base("f", "channel.of", [], [port("out")]),
          kind: "factory",
          namespace: "channel",
          factory: "of",
        },
        "channel.of",
        "Channel factory",
        "main.nf",
        7,
      ],
      [
        {
          ...base("t", "reads", [], [port("out")]),
          kind: "take",
          name: "reads",
        },
        "reads",
        "Take",
        "main.nf",
        7,
      ],
      [
        { ...base("e", "bam", [port("in")], []), kind: "emit", name: "bam" },
        "bam",
        "Emit",
        "main.nf",
        7,
      ],
      [
        { ...base("p", "params", [], [port("x")]), kind: "params" },
        "params",
        "Params block",
        "main.nf",
        7,
      ],
      [
        { ...base("o", "output", [port("x")], []), kind: "output" },
        "output",
        "Output block",
        "main.nf",
        7,
      ],
      [
        {
          ...base("k", "log.info 'x'", [], []),
          kind: "code",
          text: "log.info 'x'\nmore",
        },
        "log.info 'x'",
        "Code",
        "main.nf",
        7,
      ],
    ];
    for (const [node, name, kindLabel, path, line] of rows) {
      const v = view(node);
      expect(
        [v.name, v.kindLabel, v.path, v.line],
        `${node.kind} ${kindLabel}`,
      ).toEqual([name, kindLabel, path, line]);
      expect(v.kind).toBe(node.kind);
    }
    expect(view(call("a", { module: "nf-core/fastqc" })).module).toBe(
      "nf-core/fastqc",
    );
    expect(view(call("a")).module).toBeNull();
  });

  it("F-206 UX-30 LA-28: ports carry their formatted type and connections, from the variable or the source node and port", () => {
    const params: GraphNode = {
      ...base("p", "params", [], [port("input", flow("plain", "Path"))]),
      kind: "params",
    };
    const align = call(
      "align",
      { name: "ALIGN" },
      [port("reads", flow("channel")), port("ref", flow("value"))],
      [port("bam", flow("channel", "Bam")), port("log", flow("plain", null))],
    );
    const sort = call(
      "sort",
      { name: "SORT" },
      [port("bam", flow("channel", "Bam"))],
      [port("out", { dataflow: null, element: null })],
    );
    const p = projection(
      [params, align, sort],
      [
        edge(
          ["p", "input"],
          ["align", "reads"],
          flow("plain", "Path"),
          "params.input",
        ),
        edge(["align", "bam"], ["sort", "bam"], flow("channel", "Bam"), null),
      ],
    );
    const a = nodeView(p, "align");
    expect(a?.inputs[0]).toMatchObject({
      id: "reads",
      label: "reads",
      type: "Channel<Path>",
      connections: [
        { direction: "from", node: "p", text: "from params.input" },
      ],
    });
    expect(a?.outputs[0]).toMatchObject({
      type: "Channel<Bam>",
      connections: [{ direction: "to", node: "sort", text: "to SORT" }],
    });
    expect(a?.outputs[1]?.type).toBe("?");
    const pv = nodeView(p, "p");
    expect(pv?.outputs[0]?.connections).toEqual([
      { direction: "to", node: "align", text: "to ALIGN.reads" },
    ]);
    const s = nodeView(p, "sort");
    expect(s?.inputs[0]?.connections).toEqual([
      { direction: "from", node: "align", text: "from ALIGN.bam" },
    ]);
    expect(s?.outputs[0]?.type).toBeNull();
  });

  it("F-206 UX-30 ADR-0038: a legacy input fed by several edges lists every source", () => {
    const a = call("a", { name: "A" });
    const b = call("b", { name: "B" });
    const c = call("c", { name: "C" });
    const p = projection(
      [a, b, c],
      [
        edge(["a", "out"], ["c", "in"], flow("channel"), null),
        edge(["b", "out"], ["c", "in"], flow("channel"), "ch_b"),
      ],
    );
    expect(nodeView(p, "c")?.inputs[0]?.connections).toEqual([
      { direction: "from", node: "a", text: "from A" },
      { direction: "from", node: "b", text: "from ch_b" },
    ]);
  });

  it('F-206 UX-30: an unfed input is "not connected", an inline argument "inline", an unused output "unused"; the port is omitted for a single-port target', () => {
    const n = call(
      "n",
      { name: "N" },
      [
        port("fed"),
        port("lonely"),
        port("lit", null, {
          argument: range,
          argumentType: flow("plain", "String"),
        }),
      ],
      [port("used"), port("spare")],
    );
    const m = call("m", { name: "M" }, [port("a"), port("b")], [port("out")]);
    const chain: GraphNode = {
      ...base("ch", ".map", [port("in")], [port("out")]),
      kind: "chain",
      steps: [{ operator: "map", range, known: true }],
    };
    const p = projection(
      [n, m, chain],
      [
        edge(["m", "out"], ["n", "fed"], flow("channel"), null),
        edge(["n", "used"], ["ch", "in"], flow("channel"), null),
        edge(["n", "used"], ["m", "b"], flow("channel"), null),
      ],
    );
    const v = nodeView(p, "n");
    expect(v?.inputs.map((i) => i.unconnected)).toEqual([
      null,
      "not-connected",
      "inline",
    ]);
    expect(v?.inputs[2]?.argumentType).toBe("String");
    expect(v?.inputs[0]?.connections[0]?.text).toBe("from M");
    expect(v?.outputs.map((o) => o.unconnected)).toEqual([null, "unused"]);
    expect(v?.outputs[0]?.connections.map((c) => c.text)).toEqual([
      "to map",
      "to M.b",
    ]);
    expect(v?.outputs[1]?.connections).toEqual([]);
  });

  it("F-206 UX-30 ADR-0036: an unknown id gives null; the view survives structuredClone", () => {
    const p = projection([call("a")], [], "W");
    expect(nodeView(p, "nope")).toBeNull();
    const v = nodeView(p, "a");
    expect(structuredClone(v)).toEqual(v);
    expect(workflowRef("W").name).toBe("W");
  });
});
