// The canvas view of a projection (F-205, AR-31): appearance, title, subtitle, badge, ports and positions per node, and
// a dataflow style and tooltip per edge. Pure and plain data.

import type {
  Callee,
  FlowType,
  GraphNode,
  Port,
  Projection,
} from "@nf-builder/lang-core";
import { formatFlowType } from "../projection/types";
import { layeredLayout } from "./layout";
import { CANVAS_METRICS } from "./metrics";
import type {
  CanvasAppearance,
  CanvasEdgeView,
  CanvasNodeView,
  CanvasPortView,
  CanvasView,
  CanvasViewOptions,
} from "./types";

interface Look {
  readonly appearance: CanvasAppearance;
  readonly shape: "card" | "pill";
  readonly title: string;
  readonly subtitle: string | null;
}

const card = (
  appearance: CanvasAppearance,
  title: string,
  subtitle: string,
): Look => ({ appearance, shape: "card", title, subtitle });

function callLook(label: string, callee: Callee): Look {
  if (callee.status === "unparsed")
    return card("unparsed", label, "could not be parsed");
  if (callee.status === "unresolved")
    return card("unparsed", label, "not found");
  if (callee.kind === "workflow" || callee.kind === "pipeline")
    return card("workflow", label, callee.module ?? callee.kind);
  if (callee.module !== null) return card("module", label, callee.module);
  if (callee.kind === "agent") return card("agent", label, "agent");
  return card("process", label, callee.kind ?? "process");
}

function look(node: GraphNode): Look {
  switch (node.kind) {
    case "call":
      return callLook(node.label, node.callee);
    case "chain":
      return {
        appearance: "chain",
        shape: "pill",
        title: node.steps.map((s) => s.operator).join(" → "),
        subtitle: null,
      };
    case "factory":
      return card("factory", node.label, "channel factory");
    case "params":
      return card("params", "params", "pipeline inputs");
    case "output":
      return card("output", "output", "publish");
    case "take":
    case "emit":
      return {
        appearance: node.kind,
        shape: "pill",
        title: node.name,
        subtitle: node.kind,
      };
    case "code":
      return card("code", node.label, "code");
  }
}

/** The title the canvas draws for a node; the details pane uses it to name connections (F-206). */
export const nodeTitle = (node: GraphNode): string => look(node).title;

/** A type as the canvas and the details pane show it; null when nothing is known. */
export const typeText = (type: FlowType | null): string | null =>
  type === null || (type.dataflow === null && type.element === null)
    ? null
    : formatFlowType(type);

const portView = (p: Port): CanvasPortView => ({
  id: p.id,
  label: p.label,
  type: typeText(p.type),
});

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function size(
  shape: "card" | "pill",
  title: string,
  prefixed: boolean,
  ports: number,
  rowHeight: number,
): { width: number; height: number } {
  const m = CANVAS_METRICS;
  if (shape === "pill")
    return {
      width: Math.min(
        m.pillMaxWidth,
        Math.max(
          m.pillMinWidth,
          title.length * m.pillCharWidth +
            m.pillPadding +
            (prefixed ? m.pillPrefixWidth : 0),
        ),
      ),
      height: m.pillHeight,
    };
  return { width: m.cardWidth, height: m.headerHeight + ports * rowHeight };
}

export function canvasView(
  projection: Projection,
  options: CanvasViewOptions,
): CanvasView {
  const rowHeight = options.portLabels
    ? CANVAS_METRICS.rowHeight
    : CANVAS_METRICS.compactRowHeight;
  const sized = projection.nodes.map((node) => {
    const l = look(node);
    const dims = size(
      l.shape,
      l.title,
      l.subtitle !== null,
      Math.max(node.inputs.length, node.outputs.length),
      rowHeight,
    );
    return { id: node.id, kind: node.kind, node, look: l, ...dims };
  });
  const positions = layeredLayout(
    sized,
    projection.edges.map((e) => ({ source: e.from.node, target: e.to.node })),
  );
  const nodes: CanvasNodeView[] = sized.map(
    ({ node, look: l, width, height }) => {
      const badge =
        node.kind === "call" && node.callee.typed === true ? "typed" : null;
      const parts = [
        l.title,
        l.subtitle ?? l.appearance,
        ...(badge === null ? [] : [badge]),
        count(node.inputs.length, "input"),
        count(node.outputs.length, "output"),
      ];
      const at = positions.get(node.id) ?? { x: 0, y: 0 };
      return {
        id: node.id,
        kind: node.kind,
        appearance: l.appearance,
        shape: l.shape,
        title: l.title,
        subtitle: l.subtitle,
        badge,
        opens:
          node.kind === "call" &&
          node.callee.status === "modelled" &&
          (node.callee.kind === "workflow" || node.callee.kind === "pipeline"),
        inputs: node.inputs.map(portView),
        outputs: node.outputs.map(portView),
        ariaLabel: parts.join(", "),
        x: at.x,
        y: at.y,
        width,
        height,
        rowHeight,
      };
    },
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: CanvasEdgeView[] = projection.edges.map((e) => {
    const source = byId.get(e.from.node);
    const portLabel =
      source?.outputs.find((p) => p.id === e.from.port)?.label ?? e.from.port;
    const where = e.variable ?? `${source?.title ?? e.from.node} ${portLabel}`;
    return {
      id: e.id,
      source: e.from.node,
      sourcePort: e.from.port,
      target: e.to.node,
      targetPort: e.to.port,
      dataflow: e.type.dataflow ?? "unknown",
      tooltip: `${typeText(e.type) ?? "Unknown type"} · ${where}`,
    };
  });
  return { nodes, edges };
}
