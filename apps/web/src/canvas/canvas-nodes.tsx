// Presentational node components (AR-31): they draw what `canvasView` computed and hold no logic.
import { CANVAS_METRICS, type CanvasAppearance } from "@nf-builder/engine";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { CSSProperties, JSX } from "react";
import { type Glyph, GlyphIcon, PALETTE_GLYPHS } from "../glyphs";
import {
  type CanvasFlowNode,
  inputHandle,
  outputHandle,
} from "./flow-elements";

/** The palette's glyph where there is one; else a cube for modules, arrows for take and emit, braces for code, a warning triangle. */
const APPEARANCE_GLYPHS: Record<CanvasAppearance, Glyph> = {
  process: PALETTE_GLYPHS.process,
  agent: PALETTE_GLYPHS.agent,
  module: {
    tone: "green",
    path: "M8 2.5l5 2.5v6l-5 2.5L3 11V5zM3 5l5 2.5L13 5M8 7.5v6",
  },
  workflow: PALETTE_GLYPHS.workflow,
  chain: PALETTE_GLYPHS.operator,
  factory: PALETTE_GLYPHS.factory,
  params: PALETTE_GLYPHS.params,
  output: PALETTE_GLYPHS.output,
  take: { tone: "grey", path: "M2 8h8M7 5l3 3-3 3M13 3v10" },
  emit: { tone: "grey", path: "M3 3v10M6 8h8M11 5l3 3-3 3" },
  code: { tone: "grey", path: "M6 4 3 8l3 4M10 4l3 4-3 4" },
  unparsed: { tone: "red", path: "M8 2.5 14 13H2zM8 6.5v3M8 11.2v.1" },
};

type NodeData = CanvasFlowNode["data"];

function NodeGlyph({
  appearance,
}: {
  appearance: CanvasAppearance;
}): JSX.Element {
  return (
    <GlyphIcon
      glyph={APPEARANCE_GLYPHS[appearance]}
      className="canvas-glyph"
      name={appearance}
    />
  );
}

function Handles({ data }: { data: NodeData }): JSX.Element {
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

/** The outer box's classes and the size `canvasView` computed. */
function frame({ view, portLabels }: NodeData) {
  return {
    className: `canvas-node is-${view.appearance} is-${view.shape}${portLabels ? "" : " is-compact"}`,
    style: {
      width: view.width,
      height: view.height,
      "--port-row": `${view.rowHeight}px`,
    } as CSSProperties,
  };
}

function PortRows({ data }: { data: NodeData }): JSX.Element | null {
  const { view, portLabels } = data;
  if (!portLabels) return null;
  const rows = Math.max(view.inputs.length, view.outputs.length);
  return (
    <div className="canvas-ports">
      {Array.from({ length: rows }, (_, i) => {
        const input = view.inputs[i];
        const output = view.outputs[i];
        return (
          <div className="canvas-port-row" key={input?.id ?? output?.id ?? i}>
            <span
              className="canvas-port is-input"
              title={input?.type ?? input?.label}
            >
              {input?.label}
            </span>
            <span
              className="canvas-port is-output"
              title={output?.type ?? output?.label}
            >
              {output?.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CardNode({ data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const { view } = data;
  return (
    <div {...frame(data)}>
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

/** Chains, take and emit. Take and emit show their kind as a prefix; a chain has no subtitle. */
export function PillNode({ data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const { view } = data;
  return (
    <div {...frame(data)}>
      <NodeGlyph appearance={view.appearance} />
      {view.subtitle === null ? null : (
        <span className="canvas-pill-prefix">{view.subtitle}</span>
      )}
      <span className="canvas-node-title" title={view.title}>
        {view.title}
      </span>
      <Handles data={data} />
    </div>
  );
}

export const NODE_TYPES = { card: CardNode, pill: PillNode } as const;
