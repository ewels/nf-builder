// Presentational node components (AR-31): they draw what `canvasView` computed and hold no logic.
import { CANVAS_METRICS } from "@nf-builder/engine";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { CSSProperties, JSX } from "react";
import {
  type CanvasFlowNode,
  inputHandle,
  outputHandle,
} from "./flow-elements";

function Handles({ data }: { data: CanvasFlowNode["data"] }): JSX.Element {
  const { view } = data;
  const top = (i: number) =>
    view.shape === "pill"
      ? view.height / 2
      : CANVAS_METRICS.headerHeight + i * view.rowHeight + view.rowHeight / 2;
  return (
    <>
      {view.inputs.map((p, i) => (
        <Handle
          key={p.id}
          id={inputHandle(p)}
          type="target"
          position={Position.Left}
          style={{ top: top(i) }}
        />
      ))}
      {view.outputs.map((p, i) => (
        <Handle
          key={p.id}
          id={outputHandle(p)}
          type="source"
          position={Position.Right}
          style={{ top: top(i) }}
        />
      ))}
    </>
  );
}

function nodeStyle(data: CanvasFlowNode["data"]): CSSProperties {
  return { width: data.view.width, height: data.view.height };
}

export function CardNode({ data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const { view } = data;
  return (
    <div
      className={`canvas-node is-${view.appearance} is-card`}
      style={nodeStyle(data)}
    >
      <div className="canvas-node-header">
        <span className="canvas-node-title" title={view.title}>
          {view.title}
        </span>
        {view.subtitle === null ? null : (
          <span className="canvas-node-subtitle">{view.subtitle}</span>
        )}
      </div>
      <Handles data={data} />
    </div>
  );
}

export function PillNode({ data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const { view } = data;
  return (
    <div
      className={`canvas-node is-${view.appearance} is-pill`}
      style={nodeStyle(data)}
    >
      <span className="canvas-node-title" title={view.title}>
        {view.title}
      </span>
      <Handles data={data} />
    </div>
  );
}

export const NODE_TYPES = { card: CardNode, pill: PillNode } as const;
