// Presentational node components (AR-31): they draw what `canvasView` computed and hold no logic.
import { CANVAS_METRICS, type CanvasAppearance } from "@nf-builder/engine";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { CSSProperties, JSX } from "react";
import { CANVAS_GLYPHS, type Glyph, PALETTE_GLYPHS } from "../glyphs";
import {
  type CanvasFlowNode,
  inputHandle,
  outputHandle,
} from "./flow-elements";

const APPEARANCE_GLYPHS: Record<CanvasAppearance, Glyph> = {
  process: PALETTE_GLYPHS.process,
  module: CANVAS_GLYPHS.module,
  workflow: PALETTE_GLYPHS.workflow,
  chain: PALETTE_GLYPHS.operator,
  factory: PALETTE_GLYPHS.factory,
  params: PALETTE_GLYPHS.params,
  output: PALETTE_GLYPHS.output,
  take: CANVAS_GLYPHS.take,
  emit: CANVAS_GLYPHS.emit,
  code: CANVAS_GLYPHS.code,
  unparsed: CANVAS_GLYPHS.unparsed,
};

function NodeGlyph({
  appearance,
}: {
  appearance: CanvasAppearance;
}): JSX.Element {
  const glyph = APPEARANCE_GLYPHS[appearance];
  return (
    <span className={`canvas-glyph tone-${glyph.tone}`} data-glyph={appearance}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d={glyph.path} />
      </svg>
    </span>
  );
}

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

function nodeClass(data: CanvasFlowNode["data"], shape: string): string {
  const { view, portLabels } = data;
  return `canvas-node is-${view.appearance} is-${shape}${portLabels ? "" : " is-compact"}`;
}

function PortRows({
  data,
}: {
  data: CanvasFlowNode["data"];
}): JSX.Element | null {
  const { view, portLabels } = data;
  if (!portLabels) return null;
  const rows = Math.max(view.inputs.length, view.outputs.length);
  return (
    <div className="canvas-ports">
      {Array.from({ length: rows }, (_, i) => (
        <div
          className="canvas-port-row"
          key={view.inputs[i]?.id ?? view.outputs[i]?.id ?? i}
        >
          <span
            className="canvas-port is-input"
            title={view.inputs[i]?.type ?? view.inputs[i]?.label}
          >
            {view.inputs[i]?.label}
          </span>
          <span
            className="canvas-port is-output"
            title={view.outputs[i]?.type ?? view.outputs[i]?.label}
          >
            {view.outputs[i]?.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CardNode({ data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const { view } = data;
  return (
    <div
      className={nodeClass(data, "card")}
      style={
        {
          ...nodeStyle(data),
          "--port-row": `${view.rowHeight}px`,
        } as CSSProperties
      }
    >
      {view.badge === null ? null : (
        <span className="canvas-badge">{view.badge}</span>
      )}
      <div
        className="canvas-node-header"
        style={{ height: CANVAS_METRICS.headerHeight }}
      >
        <NodeGlyph appearance={view.appearance} />
        <span className="canvas-node-text">
          <span
            className={`canvas-node-title${view.appearance === "code" ? " is-code" : ""}`}
            title={view.title}
          >
            {view.title}
          </span>
          {view.subtitle === null ? null : (
            <span className="canvas-node-subtitle" title={view.subtitle}>
              {view.subtitle}
            </span>
          )}
        </span>
      </div>
      <PortRows data={data} />
      <Handles data={data} />
    </div>
  );
}

export function PillNode({ data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const { view } = data;
  const prefix = view.appearance === "take" || view.appearance === "emit";
  return (
    <div
      className={nodeClass(data, "pill")}
      style={
        {
          ...nodeStyle(data),
          "--port-row": `${view.rowHeight}px`,
        } as CSSProperties
      }
    >
      <NodeGlyph appearance={view.appearance} />
      {prefix && view.subtitle !== null ? (
        <span className="canvas-pill-prefix">{view.subtitle}</span>
      ) : null}
      <span className="canvas-node-title" title={view.title}>
        {view.title}
      </span>
      <Handles data={data} />
    </div>
  );
}

export const NODE_TYPES = { card: CardNode, pill: PillNode } as const;
