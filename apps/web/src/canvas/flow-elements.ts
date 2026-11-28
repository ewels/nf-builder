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
  /** The edge the user selected on the canvas, to disconnect (F-302). */
  selected: boolean;
  /** The message of the type-mismatch diagnostic on the target port, or null (UX-24, LA-32). */
  mismatch: string | null;
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

const NO_MISMATCHES: ReadonlyMap<string, string> = new Map();

/**
 * Edges touching the selected node (highlighted) come last, so they paint above other edges but, with no z-index,
 * below nodes (UX-24); mismatched edges come after those, selected or not (F-302).
 */
export function toFlowEdges(
  view: CanvasView,
  selected: string | null,
  mismatches: ReadonlyMap<string, string> = NO_MISMATCHES,
  options: { selectedEdge?: string | null; deletable?: boolean } = {},
): CanvasFlowEdge[] {
  const edges = view.edges.map((e): CanvasFlowEdge => {
    const highlighted =
      selected !== null && (e.source === selected || e.target === selected);
    const mismatch = mismatches.get(e.id) ?? null;
    const tooltip = mismatch === null ? e.tooltip : `${e.tooltip}\n${mismatch}`;
    return {
      id: e.id,
      type: "flow",
      source: e.source,
      sourceHandle: outputHandle({ id: e.sourcePort }),
      target: e.target,
      targetHandle: inputHandle({ id: e.targetPort }),
      data: {
        dataflow: e.dataflow,
        tooltip,
        highlighted,
        selected: options.selectedEdge === e.id,
        mismatch,
      },
      ariaLabel:
        options.deletable === true
          ? `${tooltip}. Press Delete to disconnect.`
          : tooltip,
      selectable: false,
    };
  });
  const order = (e: CanvasFlowEdge): number =>
    e.data?.mismatch != null
      ? 2
      : e.data?.highlighted === true || e.data?.selected === true
        ? 1
        : 0;
  return [0, 1, 2].flatMap((rank) => edges.filter((e) => order(e) === rank));
}
