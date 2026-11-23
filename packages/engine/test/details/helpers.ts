// Synthetic projections for the F-206 main-thread view tests.
import type {
  Callee,
  FlowType,
  GraphEdge,
  GraphNode,
  Port,
  Projection,
  WorkflowRef,
} from "@nf-builder/lang-core";

export const range = {
  start: 0,
  end: 0,
  line: 7,
  column: 1,
  endLine: 7,
  endColumn: 1,
};
export const workflowRef = (name: string | null = null): WorkflowRef => ({
  path: "main.nf",
  name,
  modelled: true,
  typed: true,
  range,
});
export const flow = (
  dataflow: FlowType["dataflow"],
  name: string | null = "Path",
): FlowType => ({
  dataflow,
  element: name === null ? null : { name, args: [], nullable: false },
});
export const port = (
  id: string,
  type: FlowType | null = null,
  extra: Partial<Port> = {},
): Port => ({
  id,
  label: id,
  type,
  argument: null,
  argumentType: null,
  ...extra,
});
export const base = (
  id: string,
  label: string,
  inputs: Port[],
  outputs: Port[],
) => ({ id, label, inputs, outputs, range, guards: [] });
export const callee = (over: Partial<Callee> = {}): Callee => ({
  name: "P",
  kind: "process",
  status: "modelled",
  typed: false,
  path: "p.nf",
  module: null,
  ...over,
});
export const call = (
  id: string,
  c: Partial<Callee> = {},
  inputs: Port[] = [port("in")],
  outputs: Port[] = [port("out")],
): GraphNode => ({
  ...base(id, c.name ?? "P", inputs, outputs),
  kind: "call",
  callee: callee(c),
});
export const projection = (
  nodes: GraphNode[],
  edges: GraphEdge[] = [],
  name: string | null = null,
): Projection => ({
  workflow: workflowRef(name),
  nodes,
  edges,
  statements: [],
});
export const edge = (
  from: [string, string],
  to: [string, string],
  type: FlowType,
  variable: string | null,
): GraphEdge => ({
  id: `${from[0]}[${from[1]}] -> ${to[0]}[${to[1]}]`,
  from: { node: from[0], port: from[1] },
  to: { node: to[0], port: to[1] },
  type,
  variable,
  direct: true,
});
