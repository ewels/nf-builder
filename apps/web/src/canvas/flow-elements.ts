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
} & Record<string, unknown>;
export type CanvasFlowEdge = Edge<CanvasEdgeData, "flow">;

export const inputHandle = (port: Pick<CanvasPortView, "id">): string =>
  `in:${port.id}`;
export const outputHandle = (port: Pick<CanvasPortView, "id">): string =>
  `out:${port.id}`;

export function toFlowNodes(
  view: CanvasView,
  portLabels: boolean,
): CanvasFlowNode[] {
  return view.nodes.map((n) => ({
    id: n.id,
    type: n.shape,
    position: { x: n.x, y: n.y },
    initialWidth: n.width,
    initialHeight: n.height,
    data: { view: n, portLabels },
    ariaLabel: n.ariaLabel,
  }));
}

export function toFlowEdges(view: CanvasView): CanvasFlowEdge[] {
  return view.edges.map((e) => ({
    id: e.id,
    type: "flow",
    source: e.source,
    sourceHandle: outputHandle({ id: e.sourcePort }),
    target: e.target,
    targetHandle: inputHandle({ id: e.targetPort }),
    data: { dataflow: e.dataflow, tooltip: e.tooltip },
    ariaLabel: e.tooltip,
  }));
}
