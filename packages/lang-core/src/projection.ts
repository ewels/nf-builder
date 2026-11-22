// The projection model (AR-10, F-106): one graph per workflow, as plain data so it can cross from the worker to the UI
// (AR-31, ADR 0003). Types only; the engine computes it.

import type { Range } from "./ast/range.ts";

/** A type as written or inferred; `"?"` is a wildcard or an unknown argument. `Map.Entry` keeps its dot. */
export interface TypeExpr {
  readonly name: string;
  readonly args: readonly TypeExpr[];
  readonly nullable: boolean;
}

/** `plain` is neither a channel nor a value (LA-28): a `Path`, a `String`, a `List<String>`. */
export type Dataflow = "channel" | "value" | "plain";

/**
 * What flows along a port or an edge. `dataflow` is null when not known; `element` is the `T` of `Channel<T>`,
 * `Value<T>`, or the type itself for a plain value; null when not inferred.
 */
export interface FlowType {
  readonly dataflow: Dataflow | null;
  readonly element: TypeExpr | null;
}

export type GraphNodeKind =
  | "call"
  | "chain"
  | "factory"
  | "take"
  | "emit"
  | "params"
  | "output"
  | "code";

export interface Port {
  /** Unique within the node: `out`, `in`, a declared name, `$n` or `<step>:<arg>`. */
  readonly id: string;
  readonly label: string;
  /** Input ports: the declared type. Output ports: the inferred type. */
  readonly type: FlowType | null;
  /** The expression feeding an input port, in the workflow's file; null for outputs and unfed inputs. */
  readonly argument: Range | null;
  /** The type of an inline argument (one that reads no graph value), for LA-32 checks; null otherwise. */
  readonly argumentType: FlowType | null;
}

export interface Callee {
  readonly name: string;
  readonly kind: "process" | "workflow" | "agent" | "pipeline" | null;
  readonly status: "modelled" | "unparsed" | "unresolved";
  /** Whether the callee is a typed definition; null when not known. */
  readonly typed: boolean | null;
  /** The file declaring the callee; null when not resolved. */
  readonly path: string | null;
  /** The registry module name, for a registry include. */
  readonly module: string | null;
}

export interface ChainStep {
  readonly operator: string;
  readonly range: Range;
  /** Whether the operator is in the catalogue. */
  readonly known: boolean;
}

interface NodeShape<K extends GraphNodeKind> {
  /** The layout key (AR-11, ADR 0008): see `NodeKey`. */
  readonly id: string;
  readonly kind: K;
  readonly label: string;
  readonly inputs: readonly Port[];
  readonly outputs: readonly Port[];
  readonly range: Range;
}

export interface CallNode extends NodeShape<"call"> {
  readonly callee: Callee;
}
export interface ChainNode extends NodeShape<"chain"> {
  readonly steps: readonly ChainStep[];
}
export interface FactoryNode extends NodeShape<"factory"> {
  readonly namespace: string;
  readonly factory: string;
}
export interface TakeNode extends NodeShape<"take"> {
  readonly name: string;
}
export interface EmitNode extends NodeShape<"emit"> {
  readonly name: string;
}
export type ParamsNode = NodeShape<"params">;
export type OutputNode = NodeShape<"output">;
export type CodeNode = NodeShape<"code">;

export type GraphNode =
  | CallNode
  | ChainNode
  | FactoryNode
  | TakeNode
  | EmitNode
  | ParamsNode
  | OutputNode
  | CodeNode;

export interface PortRef {
  readonly node: string;
  readonly port: string;
}

export interface GraphEdge {
  readonly id: string;
  readonly from: PortRef;
  readonly to: PortRef;
  /** The source port's type. */
  readonly type: FlowType;
  /** The variable read, such as `samples_ch`, `params.reads` or `res.txt`; null for a nested node. */
  readonly variable: string | null;
  /** False when an inline expression reads the value, as in `record(input: samples)`. */
  readonly direct: boolean;
}

export interface WorkflowRef {
  readonly path: string;
  /** Null for the entry workflow. */
  readonly name: string | null;
  /** False for a workflow the parser kept as Unparsed. */
  readonly modelled: boolean;
  readonly typed: boolean | null;
  readonly range: Range;
}

/** A branch of an `if` a statement sits in (F-107). */
export interface Guard {
  readonly condition: Range;
  readonly branch: "then" | "else";
}

/** One main statement of a workflow and what it produced (F-107 step 2). */
export interface ProjectedStatement {
  readonly range: Range;
  /** The ids of the nodes the statement created, in order. */
  readonly nodes: readonly string[];
  /** The names the statement bound. */
  readonly binds: readonly string[];
  /** True when the statement produced no code node. */
  readonly modelled: boolean;
  /** The branches around the statement, outer to inner. */
  readonly guards: readonly Guard[];
}

export interface Projection {
  readonly workflow: WorkflowRef;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Every main statement in order; a transparent `if` is replaced by its branch statements. */
  readonly statements: readonly ProjectedStatement[];
}

/** The part of a node key after `/` (AR-11). `occurrence` counts from 1. */
export type NodeKeyLocal =
  | { kind: "assigned"; variable: string; occurrence: number }
  | { kind: "unassigned"; callee: string; occurrence: number }
  | { kind: "code"; occurrence: number }
  | { kind: "take" | "emit"; name: string }
  | { kind: "params" }
  | { kind: "output" };

/** A node key: `<path>#<workflow>/<local>`; `workflow` is null for the entry workflow. */
export interface NodeKey {
  readonly path: string;
  readonly workflow: string | null;
  readonly local: NodeKeyLocal;
}
