// The projection-derived part of a node's details (F-206, UX-30): name, kind, file, and one row per port with its type
// and connections. Pure; the AST-derived part is in the worker.

import type {
  Callee,
  FlowType,
  GraphNode,
  Port,
  Projection,
} from "@nf-builder/lang-core";
import { nodeTitle } from "../canvas/view";
import { formatFlowType } from "../projection/types";
import type { NodeView, PortConnection, PortDetail } from "./types";

/** The formatted type, or null when it is unknown (no type, or neither dataflow nor element). */
export const portTypeText = (type: FlowType | null): string | null =>
  type === null || (type.dataflow === null && type.element === null)
    ? null
    : formatFlowType(type);

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function calleeLabel(callee: Callee): string {
  if (callee.status === "unresolved") return "Unresolved call";
  if (callee.status === "unparsed")
    return `${capitalise(callee.kind ?? "declaration")} (could not be parsed)`;
  const typed = callee.typed === true;
  switch (callee.kind) {
    case "process":
      return typed ? "Typed process" : "Legacy process";
    case "workflow":
      return typed ? "Typed workflow" : "Legacy workflow";
    case "agent":
      return "Agent";
    case "pipeline":
      return "Pipeline";
    default:
      return "Call";
  }
}

export function kindLabel(node: GraphNode): string {
  switch (node.kind) {
    case "call": {
      const label = calleeLabel(node.callee);
      return node.callee.module === null
        ? label
        : `${label} · registry module ${node.callee.module}`;
    }
    case "chain":
      return "Operator chain";
    case "factory":
      return "Channel factory";
    case "take":
      return "Take";
    case "emit":
      return "Emit";
    case "params":
      return "Params block";
    case "output":
      return "Output block";
    case "code":
      return "Code";
  }
}

function portDetails(
  projection: Projection,
  node: GraphNode,
  side: "inputs" | "outputs",
  byId: ReadonlyMap<string, GraphNode>,
): PortDetail[] {
  const incoming = side === "inputs";
  return node[side].map((p: Port) => {
    const connections: PortConnection[] = [];
    for (const e of projection.edges) {
      const here = incoming ? e.to : e.from;
      if (here.node !== node.id || here.port !== p.id) continue;
      const there = incoming ? e.from : e.to;
      const other = byId.get(there.node);
      const otherPorts =
        other === undefined ? [] : other[incoming ? "outputs" : "inputs"];
      const title = other === undefined ? there.node : nodeTitle(other);
      const label =
        otherPorts.find((o) => o.id === there.port)?.label ?? there.port;
      const where = otherPorts.length > 1 ? `${title}.${label}` : title;
      connections.push({
        direction: incoming ? "from" : "to",
        node: there.node,
        text: incoming ? `from ${e.variable ?? where}` : `to ${where}`,
      });
    }
    let unconnected: PortDetail["unconnected"] = null;
    if (connections.length === 0)
      unconnected = !incoming
        ? "unused"
        : p.argument !== null || p.argumentType !== null
          ? "inline"
          : "not-connected";
    return {
      id: p.id,
      label: p.label,
      type: portTypeText(p.type),
      connections,
      unconnected,
      argumentType: portTypeText(p.argumentType),
    };
  });
}

export function nodeView(projection: Projection, id: string): NodeView | null {
  const node = projection.nodes.find((n) => n.id === id);
  if (node === undefined) return null;
  const byId = new Map(projection.nodes.map((n) => [n.id, n]));
  const call = node.kind === "call" ? node.callee : null;
  return {
    id: node.id,
    kind: node.kind,
    name: nodeTitle(node),
    kindLabel: kindLabel(node),
    module: call?.module ?? null,
    path: call === null ? projection.workflow.path : call.path,
    line: call === null ? node.range.line : null,
    inputs: portDetails(projection, node, "inputs", byId),
    outputs: portDetails(projection, node, "outputs", byId),
  };
}
