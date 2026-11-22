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

function callLook(label: string, callee: Callee): Look {
  const base = { shape: "card", title: label } as const;
  if (callee.status === "unparsed")
    return { ...base, appearance: "unparsed", subtitle: "could not be parsed" };
  if (callee.status === "unresolved")
    return { ...base, appearance: "unparsed", subtitle: "not found" };
  if (callee.kind === "workflow" || callee.kind === "pipeline")
    return {
      ...base,
      appearance: "workflow",
      subtitle: callee.module ?? callee.kind,
    };
  if (callee.module !== null)
    return { ...base, appearance: "module", subtitle: callee.module };
  return { ...base, appearance: "process", subtitle: callee.kind ?? "process" };
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
      return {
        appearance: "factory",
        shape: "card",
        title: node.label,
        subtitle: "channel factory",
      };
    case "params":
      return {
        appearance: "params",
        shape: "card",
        title: "params",
        subtitle: "pipeline inputs",
      };
    case "output":
      return {
        appearance: "output",
        shape: "card",
        title: "output",
        subtitle: "publish",
      };
    case "take":
    case "emit":
      return {
        appearance: node.kind,
        shape: "pill",
        title: node.name,
        subtitle: node.kind,
      };
    case "code":
      return {
        appearance: "code",
        shape: "card",
        title: node.label,
        subtitle: "code",
      };
  }
}

const typeText = (type: FlowType | null): string | null =>
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
          title.length * m.pillCharWidth + m.pillPadding,
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
      Math.max(node.inputs.length, node.outputs.length),
      rowHeight,
    );
    return { node, look: l, ...dims };
  });
  const positions = layeredLayout(
    sized.map((s) => ({
      id: s.node.id,
      kind: s.node.kind,
      width: s.width,
      height: s.height,
    })),
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
