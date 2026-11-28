import { describe, expect, it } from "vitest";
import {
  CANVAS_METRICS,
  type CanvasEdgeView,
  type CanvasNodeView,
  type CanvasView,
  canvasView,
} from "../../src/canvas";
import {
  ELK_LAYOUT_OPTIONS,
  type ElkGraphOut,
  elkGraph,
  elkPositions,
  layoutSelection,
  type Positions,
  placeNodes,
  unplaced,
  withPositions,
} from "../../src/layout";
import { fixtureState, snapshot } from "./helpers";

const GAP = CANVAS_METRICS.rowGap;

function node(
  id: string,
  kind: CanvasNodeView["kind"] = "call",
  inputs: string[] = [],
  outputs: string[] = [],
  size = { width: 208, height: 80 },
): CanvasNodeView {
  const port = (p: string) => ({ id: p, label: p, type: null });
  return {
    id,
    kind,
    appearance: "process",
    shape: "card",
    title: id,
    subtitle: null,
    badge: null,
    opens: false,
    inputs: inputs.map(port),
    outputs: outputs.map(port),
    ariaLabel: id,
    x: 0,
    y: 0,
    ...size,
    rowHeight: 20,
  };
}
const edge = (
  source: string,
  target: string,
  id = `${source}>${target}`,
): CanvasEdgeView => ({
  id,
  source,
  sourcePort: "out",
  target,
  targetPort: "in",
  dataflow: "channel",
  tooltip: "",
});
const view = (
  nodes: CanvasNodeView[],
  edges: CanvasEdgeView[] = [],
): CanvasView => ({ nodes, edges });

const overlap = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  an: CanvasNodeView,
  bn: CanvasNodeView,
) =>
  a.x < b.x + bn.width &&
  b.x < a.x + an.width &&
  a.y < b.y + bn.height &&
  b.y < a.y + an.height;

describe("F-207 placement", () => {
  it("F-207 ADR-0008: elkGraph has one node per view node with its size, inputs west and outputs east in port order, and one edge per view edge", async () => {
    const state = await fixtureState();
    const projection = snapshot(state).projections.get("main.nf#");
    if (!projection) throw new Error("no projection");
    const v = canvasView(projection, { portLabels: true });
    const graph = elkGraph(v);
    expect(graph.children.map((c) => c.id)).toEqual(v.nodes.map((n) => n.id));
    expect(graph.edges).toHaveLength(v.edges.length);
    expect(graph.layoutOptions).toEqual(ELK_LAYOUT_OPTIONS);
    for (const n of v.nodes) {
      const c = graph.children.find((x) => x.id === n.id);
      expect(c).toMatchObject({ width: n.width, height: n.height });
      expect(c?.layoutOptions?.["org.eclipse.elk.portConstraints"]).toBe(
        "FIXED_ORDER",
      );
      const west = c?.ports.filter(
        (p) => p.layoutOptions["org.eclipse.elk.port.side"] === "WEST",
      );
      const east = c?.ports.filter(
        (p) => p.layoutOptions["org.eclipse.elk.port.side"] === "EAST",
      );
      expect(west).toHaveLength(n.inputs.length);
      expect(east).toHaveLength(n.outputs.length);
      expect(
        west?.map((p) => p.layoutOptions["org.eclipse.elk.port.index"]),
      ).toEqual(n.inputs.map((_, i) => String(i)));
      expect(east?.every((p) => p.x === n.width)).toBe(true);
      expect(west?.every((p) => p.x === 0)).toBe(true);
      // port rows sit below the header, one row apart
      if (n.shape === "card")
        n.inputs.forEach((_, i) => {
          expect(west?.[i]?.y).toBe(
            CANVAS_METRICS.headerHeight + i * n.rowHeight + n.rowHeight / 2,
          );
        });
    }
    // every edge joins ports that exist
    const ports = new Set(
      graph.children.flatMap((c) => c.ports.map((p) => p.id)),
    );
    for (const e of graph.edges) {
      expect(ports.has(e.sources[0] as string)).toBe(true);
      expect(ports.has(e.targets[0] as string)).toBe(true);
    }
    // a subset keeps only its nodes and the edges between them
    const only = new Set([v.edges[0]?.source, v.edges[0]?.target] as string[]);
    const sub = elkGraph(v, only);
    expect(sub.children.map((c) => c.id).sort()).toEqual([...only].sort());
    expect(sub.edges.length).toBeGreaterThanOrEqual(1);
    expect(sub.edges.length).toBeLessThanOrEqual(v.edges.length);
    expect(
      elkPositions({
        children: [{ id: "a", x: 1.5, y: 2 }, { id: "b" }],
      }),
    ).toEqual({ a: { x: 1.5, y: 2 } });
  });

  it("F-207 ADR-0008: take and params are constrained to the first layer, emit and output to the last", () => {
    const v = view([
      node("w#/:take:x", "take", [], ["out"]),
      node("w#/:params", "params", [], ["out"]),
      node("w#/a", "call", ["in"], ["out"]),
      node("w#/:emit:y", "emit", ["in"], []),
      node("w#/:output", "output", ["in"], []),
    ]);
    const layer = (id: string) =>
      elkGraph(v).children.find((c) => c.id === id)?.layoutOptions?.[
        "org.eclipse.elk.layered.layering.layerConstraint"
      ];
    expect(layer("w#/:take:x")).toBe("FIRST");
    expect(layer("w#/:params")).toBe("FIRST");
    expect(layer("w#/:emit:y")).toBe("LAST");
    expect(layer("w#/:output")).toBe("LAST");
    expect(layer("w#/a")).toBeUndefined();
    expect(ELK_LAYOUT_OPTIONS["org.eclipse.elk.algorithm"]).toBe("layered");
    expect(ELK_LAYOUT_OPTIONS["org.eclipse.elk.direction"]).toBe("RIGHT");
  });

  it("F-207 ADR-0008: placeNodes returns ELK positions when nothing is stored and never moves a stored node", () => {
    const v = view([node("a"), node("b"), node("c")], [edge("a", "b")]);
    const elk: Positions = {
      a: { x: 12, y: 12 },
      b: { x: 284, y: 12 },
      c: { x: 12, y: 116 },
    };
    expect(placeNodes(v, {}, elk)).toEqual(elk);
    expect(unplaced(v, {})).toEqual(["a", "b", "c"]);
    const stored: Positions = { a: { x: 500, y: 500 }, zzz: { x: 1, y: 1 } };
    expect(unplaced(v, stored)).toEqual(["b", "c"]);
    const placed = placeNodes(v, stored, elk);
    expect(placed.a).toBe(stored.a);
    expect(Object.keys(placed).sort()).toEqual(["a", "b", "c"]);
    // all stored: nothing changes
    const all: Positions = {
      a: { x: 1, y: 2 },
      b: { x: 3, y: 4 },
      c: { x: 5, y: 6 },
    };
    expect(placeNodes(v, all, elk)).toEqual(all);
  });

  it("F-207 ADR-0008: a new node keeps its ELK offset from a placed neighbour; a node with no placed neighbour goes below; nothing overlaps", () => {
    const v = view(
      [node("a"), node("b"), node("c"), node("lonely"), node("d")],
      [edge("a", "b"), edge("b", "c"), edge("d", "a")],
    );
    const elk: Positions = {
      d: { x: 12, y: 12 },
      a: { x: 284, y: 12 },
      b: { x: 556, y: 12 },
      c: { x: 828, y: 12 },
      lonely: { x: 284, y: 200 },
    };
    // a is stored far from where ELK put it; b follows a, c follows b, d precedes a
    const stored: Positions = { a: { x: 1000, y: 400 } };
    const placed = placeNodes(v, stored, elk);
    expect(placed.b).toEqual({ x: 1000 + 272, y: 400 });
    expect(placed.c).toEqual({ x: 1000 + 544, y: 400 });
    expect(placed.d).toEqual({ x: 1000 - 272, y: 400 });
    // the lonely node has no neighbour: below everything placed, keeping ELK's x
    const bottom = Math.max(
      ...["a", "b", "c", "d"].map((id) => (placed[id]?.y ?? 0) + 80),
    );
    expect(placed.lonely?.x).toBe(284);
    expect(placed.lonely?.y).toBeGreaterThanOrEqual(bottom + GAP);
    // a node ELK put on top of a stored one is pushed down clear of it
    const crowded = view([node("p"), node("q")], [edge("p", "q")]);
    const pushed = placeNodes(
      crowded,
      { p: { x: 0, y: 0 } },
      { p: { x: 0, y: 0 }, q: { x: 10, y: 10 } },
    );
    expect(pushed.p).toEqual({ x: 0, y: 0 });
    expect(pushed.q?.y).toBe(80 + GAP);
    // no pair overlaps (with the gap), whatever ELK said
    for (const result of [placed, pushed]) {
      const vv = result === placed ? v : crowded;
      for (const x of vv.nodes)
        for (const y of vv.nodes)
          if (x.id < y.id)
            expect(
              overlap(result[x.id] as never, result[y.id] as never, x, y),
              `${x.id} and ${y.id}`,
            ).toBe(false);
    }
  });

  it("F-207 UX-26: layoutSelection moves only the selected nodes and keeps their top-left corner", () => {
    const v = view([node("a"), node("b"), node("c")], [edge("a", "b")]);
    const current: Positions = {
      a: { x: 300, y: 500 },
      b: { x: 900, y: 700 },
      c: { x: 0, y: 0 },
    };
    const elk: Positions = {
      a: { x: 12, y: 12 },
      b: { x: 284, y: 100 },
      c: { x: 12, y: 300 },
    };
    const moved = layoutSelection(v, current, new Set(["a", "b"]), elk);
    expect(moved.c).toBe(current.c);
    // top-left of the selection stays at (300, 500)
    expect(moved.a).toEqual({ x: 300, y: 500 });
    expect(moved.b).toEqual({ x: 300 + 272, y: 500 + 88 });
    expect(withPositions(v, moved).nodes.map((n) => [n.id, n.x, n.y])).toEqual([
      ["a", 300, 500],
      ["b", 572, 588],
      ["c", 0, 0],
    ]);
    // the input view is untouched
    expect(v.nodes[0]?.x).toBe(0);
    const out: ElkGraphOut = { children: [{ id: "a", x: 0, y: 0 }] };
    expect(elkPositions(out)).toEqual({ a: { x: 0, y: 0 } });
  });
});
