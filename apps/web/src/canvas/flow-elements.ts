// Projection view to React Flow elements (F-205, AR-31): ids, positions and sizes are passed through unchanged.
import type {
  CanvasNodeView,
  CanvasPortView,
  CanvasView,
  EdgeDataflow,
} from "@nf-builder/engine";
import type { Edge, Node } from "@xyflow/react";

type CanvasNodeData = {
  view: CanvasNodeView;
  portLabels: boolean;
} & Record<string, unknown>;
export type CanvasFlowNode = Node<CanvasNodeData, "card" | "pill">;
type CanvasEdgeData = {
  dataflow: EdgeDataflow;
  tooltip: string;
  /** The edge touches the selected node (UX-24). */
  highlighted: boolean;
} & Record<string, unknown>;
export type CanvasFlowEdge = Edge<CanvasEdgeData, "flow">;

export const inputHandle = (port: Pick<CanvasPortView, "id">): string =>
  `in:${port.id}`;
export const outputHandle = (port: Pick<CanvasPortView, "id">): string =>
  `out:${port.id}`;

export function toFlowNodes(
  view: CanvasView,
  portLabels: boolean,
  selected: string | null,
): CanvasFlowNode[] {
  return view.nodes.map((n) => ({
    id: n.id,
    type: n.shape,
    position: { x: n.x, y: n.y },
    initialWidth: n.width,
    initialHeight: n.height,
    data: { view: n, portLabels },
    selected: n.id === selected,
    ariaLabel: n.ariaLabel,
  }));
}

/** Edges touching the selected node (highlighted) come last, so they paint above other edges but, with no z-index, below nodes (UX-24). */
export function toFlowEdges(
  view: CanvasView,
  selected: string | null,
): CanvasFlowEdge[] {
  const edges = view.edges.map((e): CanvasFlowEdge => {
    const highlighted =
      selected !== null && (e.source === selected || e.target === selected);
    return {
      id: e.id,
      type: "flow",
      source: e.source,
      sourceHandle: outputHandle({ id: e.sourcePort }),
      target: e.target,
      targetHandle: inputHandle({ id: e.targetPort }),
      data: { dataflow: e.dataflow, tooltip: e.tooltip, highlighted },
      ariaLabel: e.tooltip,
      selectable: false,
    };
  });
  return [
    ...edges.filter((e) => e.data?.highlighted !== true),
    ...edges.filter((e) => e.data?.highlighted === true),
  ];
}
