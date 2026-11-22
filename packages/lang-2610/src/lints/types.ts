// Type compatibility and the type rules (LA-29, LA-32, F-112). `assignable` follows nf-lang v26.10.7
// `Types.isAssignableFrom` (L103-L159); the rules follow `TypeCheckingVisitor` `checkProcessCall` (L974-L1065), the
// generic argument check (L829), the emit check (L338, L525) and the workflow output check (L267). Only what the
// projection knows is compared: anything unknown is never incompatible (LA-29).
import type {
  Compatibility,
  FlowType,
  GraphEdge,
  GraphNode,
  LintContext,
  LintFinding,
  LintRule,
  NamedOutput,
  PackLints,
  Port,
  Projection,
  TypeExpr,
  WorkflowDef,
} from "@nf-builder/lang-core";
import { arityMismatches } from "./calls.ts";
import { scriptOf } from "./scan.ts";

const BUILTIN = new Set([
  "Boolean",
  "Integer",
  "Float",
  "String",
  "Path",
  "Duration",
  "MemoryUnit",
  "List",
  "Set",
  "Bag",
  "Map",
  "Iterable",
  "Tuple",
  "Record",
]);
const ITERABLES = new Set(["List", "Set", "Bag", "Iterable"]);

/** A type as `nextflow lint` prints it: `List<String>`, `Map<String, ?>`, `Path?`. */
export function nfTypeName(type: TypeExpr): string {
  const args =
    type.args.length === 0 ? "" : `<${type.args.map(nfTypeName).join(", ")}>`;
  return `${type.name}${args}${type.nullable ? "?" : ""}`;
}

/** `Channel<T>`, `Value<T>`, the type itself for a plain value, `?` when nothing is known. */
export function nfFlowTypeName(type: FlowType): string {
  const element = type.element === null ? "?" : nfTypeName(type.element);
  switch (type.dataflow) {
    case "channel":
      return `Channel<${element}>`;
    case "value":
      return `Value<${element}>`;
    default:
      return element;
  }
}

function argumentsAssignable(
  target: readonly TypeExpr[],
  source: readonly TypeExpr[],
  isRecord?: (name: string) => boolean,
): boolean | null {
  if (target.length === 0 || source.length === 0) return true;
  if (target.length !== source.length) return false;
  let unknown = false;
  for (let i = 0; i < target.length; i++) {
    const a = target[i] as TypeExpr;
    const b = source[i] as TypeExpr;
    if (a.name === "?" || b.name === "?") continue;
    const result = assignable(a, b, isRecord);
    if (result === false) return false;
    if (result === null) unknown = true;
  }
  return unknown ? null : true;
}

/**
 * Whether a value of type `source` can be assigned to `target`: true, false, or null when the types don't say. A
 * wildcard or `Object` target accepts anything; a wildcard source is unknown. Integer goes to Float, `List`, `Set` and
 * `Bag` to `Iterable`; two different built-in types are incompatible. A user record (`isRecord`) is structural, so
 * against another record or `Record` it is unknown, and against any other built-in type incompatible.
 */
export function assignable(
  target: TypeExpr,
  source: TypeExpr,
  isRecord?: (name: string) => boolean,
): boolean | null {
  if (target.name === "?" || target.name === "Object") return true;
  if (source.name === "?" || source.name === "Object") return null;
  const targetRecord = isRecord?.(target.name) ?? false;
  const sourceRecord = isRecord?.(source.name) ?? false;
  if (target.name === "Record")
    return source.name === "Record" || sourceRecord
      ? true
      : BUILTIN.has(source.name)
        ? false
        : null;
  if (targetRecord) {
    if (sourceRecord) return source.name === target.name ? true : null;
    if (source.name === "Record") return null;
    return BUILTIN.has(source.name) ? false : null;
  }
  if (sourceRecord) return BUILTIN.has(target.name) ? false : null;
  const same = target.name === source.name;
  const related =
    same ||
    (target.name === "Float" && source.name === "Integer") ||
    (target.name === "Iterable" && ITERABLES.has(source.name));
  if (!related)
    return BUILTIN.has(target.name) && BUILTIN.has(source.name) ? false : null;
  return argumentsAssignable(target.args, source.args, isRecord);
}

const verdict = (result: boolean | null): Compatibility =>
  result === null ? "unknown" : result ? "compatible" : "incompatible";

/** Takes, emits and outputs: the dataflow kinds must be equal, then the elements. */
function asTake(
  target: FlowType,
  source: FlowType,
  isRecord?: (name: string) => boolean,
): Compatibility {
  if (target.dataflow === null || source.dataflow === null) return "unknown";
  if (target.dataflow !== source.dataflow) return "incompatible";
  return verdict(
    assignable(
      target.element as TypeExpr,
      source.element as TypeExpr,
      isRecord,
    ),
  );
}

/** nf-lang's `asDataflowType` (L273): a plain output target takes the kind of a value source. */
export function outputTarget(target: FlowType, source: FlowType): FlowType {
  if (target.dataflow === "channel" || target.dataflow === "value")
    return target;
  return source.dataflow === "value"
    ? { ...target, dataflow: "value" }
    : target;
}

/**
 * Whether `source` can be connected to `port` of `node`. A process or agent input compares elements, a workflow take
 * and an emit compare kind and element, an output compares as nf-lang's `asDataflowType` says. Anything else, an
 * undeclared type, a legacy or unresolved callee, or an unknown source, is `"unknown"`.
 */
export const connection: PackLints["connection"] = (
  source,
  node,
  port,
  isRecord,
) => {
  const target = port.type;
  if (!source || !target || !source.element || !target.element)
    return "unknown";
  switch (node.kind) {
    case "call": {
      const { callee } = node;
      if (callee.status !== "modelled" || callee.typed !== true)
        return "unknown";
      if (callee.kind === "process" || callee.kind === "agent")
        return verdict(assignable(target.element, source.element, isRecord));
      return callee.kind === "workflow"
        ? asTake(target, source, isRecord)
        : "unknown";
    }
    case "emit":
      // a plain emit type is a different error (nf-lang `checkWorkflowEmitTypes`), not a mismatch
      return target.dataflow === "plain"
        ? "unknown"
        : asTake(target, source, isRecord);
    case "output":
      return asTake(outputTarget(target, source), source, isRecord);
    default:
      return "unknown";
  }
};

type EdgeIndex = ReadonlyMap<string, readonly GraphEdge[]>;
const key = (node: string, port: string): string => `${node}\u0000${port}`;

function indexEdges(projection: Projection): EdgeIndex {
  const index = new Map<string, GraphEdge[]>();
  for (const edge of projection.edges) {
    const k = key(edge.to.node, edge.to.port);
    const list = index.get(k);
    if (list) list.push(edge);
    else index.set(k, [edge]);
  }
  return index;
}

/** What flows into a port: the one direct edge's type, else the inline argument's type; null when not known. */
function sourceOf(index: EdgeIndex, node: GraphNode, port: Port) {
  const edges = index.get(key(node.id, port.id)) ?? [];
  if (edges.length === 0) return port.argumentType;
  const [only] = edges;
  return edges.length === 1 && only?.direct ? only.type : null;
}

const isRecordIn =
  (context: LintContext) =>
  (name: string): boolean =>
    context.lookup(name)?.declaration?.kind === "Record";

const workflowOf = (context: LintContext, projection: Projection) => {
  const name = projection.workflow.name;
  return scriptOf(context)?.body.find(
    (item): item is WorkflowDef =>
      item.kind === "Workflow" && (item.name?.name ?? null) === name,
  );
};

/** `TypeCheckingVisitor.java#L1007`, `#L829`, `#L525` and `#L267`: a typed argument, emit or output of the wrong type. */
export const typeMismatch: LintRule = {
  code: "type-mismatch",
  check: (context) => {
    if (!scriptOf(context)?.typesEnabled) return [];
    const wrongCount = new Set(
      arityMismatches(context).map((m) => m.call.range.start),
    );
    const isRecord = isRecordIn(context);
    const out: LintFinding[] = [];
    for (const projection of context.projections()) {
      const index = indexEdges(projection);
      for (const node of projection.nodes) {
        if (node.kind === "call") {
          // nf-lang checks the arguments only when their number is right
          if (wrongCount.has(node.range.start)) continue;
          for (const port of node.inputs) {
            const source = sourceOf(index, node, port);
            if (
              !source ||
              !port.argument ||
              !port.type ||
              connection(source, node, port, isRecord) !== "incompatible"
            )
              continue;
            const { callee } = node;
            if (callee.kind === "workflow") {
              const target = nfFlowTypeName(port.type);
              out.push({
                range: port.argument,
                message: `Argument with type ${nfFlowTypeName(source)} is not compatible with parameter of type ${target} -- pass a ${target}`,
              });
            } else {
              const element = nfTypeName(port.type.element as TypeExpr);
              const label = callee.kind === "agent" ? "agent" : "process";
              out.push({
                range: port.argument,
                message: `Argument with type ${nfTypeName(source.element as TypeExpr)} is not compatible with ${label} input of type ${element} -- pass a ${element}, or a channel or value of ${element}`,
              });
            }
          }
        } else if (node.kind === "emit") {
          const port = node.inputs[0];
          const item = workflowOf(context, projection)?.emits?.items.find(
            (i): i is NamedOutput =>
              i.kind === "NamedOutput" && i.name.name === node.name,
          );
          const source = port && sourceOf(index, node, port);
          if (
            !port?.type ||
            !source ||
            !item ||
            connection(source, node, port, isRecord) !== "incompatible"
          )
            continue;
          const target = nfFlowTypeName(port.type);
          const actual = nfFlowTypeName(source);
          out.push({
            range: item.range,
            message: `${item.value === null ? `Workflow emit \`${node.name}\`` : "Assignment target"} with type ${target} cannot be assigned to value with type ${actual} -- change the declared type, or emit a ${actual}`,
          });
        } else if (node.kind === "output") {
          const def = workflowOf(context, projection);
          for (const port of node.inputs) {
            const source = sourceOf(index, node, port);
            const item = def?.publishers?.items.find(
              (i) => i.name.name === port.id,
            );
            if (
              !port.type ||
              !source ||
              !item ||
              connection(source, node, port, isRecord) !== "incompatible"
            )
              continue;
            const target = outputTarget(port.type, source);
            out.push({
              range: item.range,
              message: `Workflow output \`${port.id}\` with type ${nfFlowTypeName(target)} cannot be assigned to value with type ${nfFlowTypeName(source)} -- change the output's type in the output block, or publish a value of type ${nfTypeName(target.element as TypeExpr)}`,
            });
          }
        }
      }
    }
    return out;
  },
};

/** `TypeCheckingVisitor.java#L1013`: a typed process or agent called with more than one channel argument. */
export const multipleChannels: LintRule = {
  code: "multiple-channels",
  check: (context) => {
    if (!scriptOf(context)?.typesEnabled) return [];
    const wrongCount = new Set(
      arityMismatches(context).map((m) => m.call.range.start),
    );
    const out: LintFinding[] = [];
    for (const projection of context.projections()) {
      const index = indexEdges(projection);
      for (const node of projection.nodes) {
        if (node.kind !== "call" || wrongCount.has(node.range.start)) continue;
        const { callee } = node;
        if (
          callee.status !== "modelled" ||
          callee.typed !== true ||
          (callee.kind !== "process" && callee.kind !== "agent")
        )
          continue;
        const channels = node.inputs.filter(
          (port) =>
            port.argument !== null &&
            sourceOf(index, node, port)?.dataflow === "channel",
        ).length;
        if (channels > 1)
          out.push({
            range: node.range,
            message: `${callee.kind === "agent" ? "Agent" : "Process"} \`${callee.name}\` was called with multiple channel arguments which can lead to non-deterministic behavior -- make sure that at most one argument is a channel and that all other arguments are dataflow values`,
          });
      }
    }
    return out;
  },
};
