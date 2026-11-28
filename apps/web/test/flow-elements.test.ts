import type { CanvasView } from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import {
  inputHandle,
  outputHandle,
  toFlowEdges,
  toFlowNodes,
} from "../src/canvas/flow-elements";

const view: CanvasView = {
  nodes: [
    {
      id: "main.nf#/a",
      kind: "call",
      appearance: "process",
      shape: "card",
      title: "A",
      subtitle: "process",
      badge: null,
      opens: false,
      inputs: [{ id: "x", label: "x", type: null }],
      outputs: [{ id: "out", label: "out", type: null }],
      ariaLabel: "A, process, 1 input, 1 output",
      x: 10,
      y: 20,
      width: 208,
      height: 84,
      rowHeight: 20,
    },
    {
      id: "main.nf#/:emit:r",
      kind: "emit",
      appearance: "emit",
      shape: "pill",
      title: "r",
      subtitle: "emit",
      badge: null,
      opens: false,
      inputs: [{ id: "in", label: "in", type: null }],
      outputs: [],
      ariaLabel: "r, emit, 1 input, 0 outputs",
      x: 300,
      y: 30,
      width: 96,
      height: 32,
      rowHeight: 20,
    },
  ],
  edges: [
    {
      id: "e1",
      source: "main.nf#/a",
      sourcePort: "out",
      target: "main.nf#/:emit:r",
      targetPort: "in",
      dataflow: "value",
      tooltip: "Value<Path> · params.fasta",
    },
  ],
};

describe("F-205 flow elements", () => {
  it("F-205 AR-31: toFlowNodes keeps ids, positions and sizes and passes the view as data", () => {
    const nodes = toFlowNodes(view, false);
    expect(
      nodes.map((n) => [
        n.id,
        n.type,
        n.position,
        n.initialWidth,
        n.initialHeight,
      ]),
    ).toEqual([
      ["main.nf#/a", "card", { x: 10, y: 20 }, 208, 84],
      ["main.nf#/:emit:r", "pill", { x: 300, y: 30 }, 96, 32],
    ]);
    expect(nodes[0]?.data.view).toBe(view.nodes[0]);
    expect(nodes[0]?.data.portLabels).toBe(false);
  });

  it("F-205 UX-24: toFlowEdges maps ports to handle ids and sets aria labels from tooltips", () => {
    const [edge] = toFlowEdges(view, null);
    expect(edge).toMatchObject({
      id: "e1",
      type: "flow",
      source: "main.nf#/a",
      sourceHandle: outputHandle({ id: "out" }),
      target: "main.nf#/:emit:r",
      targetHandle: inputHandle({ id: "in" }),
      ariaLabel: "Value<Path> · params.fasta",
      data: { dataflow: "value" },
    });
    expect(outputHandle({ id: "out" })).toBe("out:out");
    expect(inputHandle({ id: "x" })).toBe("in:x");
  });

  it("F-206 UX-24: edges touching the selected node are highlighted; edges are not selectable", () => {
    const [edge] = toFlowEdges(view, "main.nf#/a");
    expect(edge?.data?.highlighted).toBe(true);
    expect(edge?.selectable).toBe(false);
    const [target] = toFlowEdges(view, "main.nf#/:emit:r");
    expect(target?.data?.highlighted).toBe(true);
    const [other] = toFlowEdges(view, "main.nf#/other");
    expect(other?.data?.highlighted).toBe(false);
    expect(other?.selectable).toBe(false);
    expect(toFlowEdges(view, null)[0]?.data?.highlighted).toBe(false);
  });

  it("F-206 UX-24 QA-12: highlighted edges come last, so they paint above other edges but below nodes", () => {
    const first = view.edges[0];
    if (first === undefined) throw new Error("no edge");
    const wide: CanvasView = {
      ...view,
      edges: [
        first,
        { ...first, id: "e2", source: "main.nf#/other" },
        { ...first, id: "e3" },
      ],
    };
    const edges = toFlowEdges(wide, "main.nf#/a");
    expect(edges.map((e) => [e.id, e.data?.highlighted])).toEqual([
      ["e2", false],
      ["e1", true],
      ["e3", true],
    ]);
    expect(edges.every((e) => e.zIndex === undefined)).toBe(true);
    expect(toFlowEdges(wide, null).map((e) => e.id)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
  });

  it("F-302 UX-24: a mismatched edge carries its message and class, which wins over the highlight; edges stay not selectable for React Flow", () => {
    const marks = new Map([["e1", "Type mismatch: Path into Sample."]]);
    const [edge] = toFlowEdges(view, "main.nf#/a", marks, {
      deletable: true,
      selectedEdge: "e1",
    });
    expect(edge?.data?.mismatch).toBe("Type mismatch: Path into Sample.");
    expect(edge?.data?.highlighted).toBe(true);
    expect(edge?.data?.selected).toBe(true);
    expect(edge?.data?.tooltip).toBe(
      "Value<Path> · params.fasta\nType mismatch: Path into Sample.",
    );
    expect(edge?.ariaLabel).toBe(
      "Value<Path> · params.fasta\nType mismatch: Path into Sample.. Press Delete to disconnect.",
    );
    expect(edge?.selectable).toBe(false);
    expect(edge?.ariaRole).toBe("button");
    expect(edge?.domAttributes).toEqual({ "aria-pressed": true });
    const [plain] = toFlowEdges(view, null);
    expect(plain?.data?.mismatch).toBeNull();
    expect(plain?.data?.selected).toBe(false);
    expect(plain?.ariaLabel).toBe("Value<Path> · params.fasta");
    expect(plain?.ariaRole).toBeUndefined();
    const [other] = toFlowEdges(view, null, undefined, {
      deletable: true,
      selectedEdge: "nope",
    });
    expect(other?.domAttributes).toEqual({ "aria-pressed": false });
  });
});
