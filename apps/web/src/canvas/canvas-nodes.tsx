// Presentational node components (AR-31): they draw what `canvasView` computed and hold no logic.
import {
  CANVAS_METRICS,
  type CanvasAppearance,
  type CanvasPortView,
  portY,
} from "@nf-builder/engine";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { type CSSProperties, type JSX, useContext } from "react";
import { type Glyph, GlyphIcon, PALETTE_GLYPHS } from "../glyphs";
import { ConnectTargetsContext } from "./connect-targets";
import {
  type CanvasFlowNode,
  inputHandle,
  openHintId,
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

/** The class and title a dragged connection's status gives an input port (F-302, UX-25); `ok` and no drag give none. */
const TARGET_CLASSES = {
  refused: "is-target-refused",
  mismatch: "is-target-mismatch",
} as const;
const TARGET_TITLES = {
  refused: "This port can't be connected to the port being dragged.",
  mismatch:
    "The types don't match: the connection is allowed, and is reported as an error.",
} as const;

function useTargetStatus(node: string, port: string) {
  const status = useContext(ConnectTargetsContext)?.get(node)?.get(port);
  return status === "refused" || status === "mismatch" ? status : null;
}

/** What a selected workflow call adds to its description: the second Enter opens it (F-307, UX-50). */
function OpenHint({
  data,
  selected,
}: {
  data: NodeData;
  selected: boolean;
}): JSX.Element | null {
  if (!selected || !data.view.opens) return null;
  return (
    <span className="visually-hidden" id={openHintId(data.view.id)}>
      Press Enter again to open this workflow
    </span>
  );
}

function Handles({ data }: { data: NodeData }): JSX.Element {
  const { view } = data;
  return (
    <>
      {view.inputs.map((p, i) => (
        <InputHandle key={p.id} data={data} port={p} index={i} />
      ))}
      {view.outputs.map((p, i) => (
        <Handle
          key={p.id}
          id={outputHandle(p)}
          type="source"
          position={Position.Right}
          isConnectableEnd={false}
          style={{ top: portY(view, i) }}
        />
      ))}
    </>
  );
}

function InputHandle({
  data,
  port: p,
  index,
}: {
  data: NodeData;
  port: CanvasPortView;
  index: number;
}): JSX.Element {
  const { view } = data;
  const status = useTargetStatus(view.id, p.id);
  return (
    <Handle
      id={inputHandle(p)}
      type="target"
      position={Position.Left}
      isConnectableStart={false}
      className={status === null ? undefined : TARGET_CLASSES[status]}
      style={{ top: portY(view, index) }}
    />
  );
}

/** The outer box's classes and the size `canvasView` computed. A card none of whose inputs can take the dragged connection dims. */
function frame({ view, portLabels }: NodeData, dimmed: boolean) {
  return {
    className: `canvas-node is-${view.appearance} is-${view.shape}${portLabels ? "" : " is-compact"}${dimmed ? " is-dimmed" : ""}`,
    style: {
      width: view.width,
      height: view.height,
      "--port-row": `${view.rowHeight}px`,
    } as CSSProperties,
  };
}

function useDimmed({ view }: NodeData): boolean {
  const targets = useContext(ConnectTargetsContext);
  if (targets === null) return false;
  const ports = targets.get(view.id);
  return !view.inputs.some((p) => {
    const status = ports?.get(p.id);
    return status === "ok" || status === "mismatch";
  });
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
            <InputLabel data={data} input={input} />
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

function InputLabel({
  data,
  input,
}: {
  data: NodeData;
  input: CanvasPortView | undefined;
}): JSX.Element {
  const status = useTargetStatus(data.view.id, input?.id ?? "");
  return (
    <span
      className={`canvas-port is-input${status === null ? "" : ` ${TARGET_CLASSES[status]}`}`}
      title={
        status === null ? (input?.type ?? input?.label) : TARGET_TITLES[status]
      }
    >
      {input?.label}
    </span>
  );
}

export function CardNode({
  data,
  selected,
}: NodeProps<CanvasFlowNode>): JSX.Element {
  const { view } = data;
  const dimmed = useDimmed(data);
  return (
    <div {...frame(data, dimmed)}>
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
      <OpenHint data={data} selected={selected} />
    </div>
  );
}

/** Chains, take and emit. Take and emit show their kind as a prefix; a chain has no subtitle. */
export function PillNode({ data }: NodeProps<CanvasFlowNode>): JSX.Element {
  const { view } = data;
  const dimmed = useDimmed(data);
  return (
    <div {...frame(data, dimmed)}>
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
