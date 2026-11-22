// A code node (AR-13, LA-27, ADR 0004): a statement the projection does not model, with ports from its free variables.
// Inputs are the free reads that resolve to graph values, one port per distinct reference; outputs are the variables the
// statement assigns, in first-write order.

import type {
  CodeNode,
  Expression,
  FlowType,
  GraphEdge,
  Port,
  Statement,
} from "@nf-builder/lang-core";
import { statementVariables } from "./free-variables";
import type { KeyAllocator } from "./keys";
import type { WorkflowScope } from "./scope";
import { type PortSpec, spec } from "./signature";
import { UNKNOWN } from "./types";

export interface CodeContext {
  readonly scope: WorkflowScope;
  readonly keys: KeyAllocator;
  /** The whole source text of the workflow's file. */
  readonly text: string;
  /** The type of the expression a single assignment copies or computes (F-106's inline typing). */
  readonly typeOf: (expression: Expression) => FlowType | null;
}

const LABEL_LENGTH = 60;

/** The expression of a single assignment `x = e` or `def x = e`; null for any other statement. */
function assignedValue(statement: Statement): Expression | null {
  if (
    statement.kind === "VariableDeclaration" &&
    !statement.multiple &&
    statement.targets.length === 1
  )
    return statement.initializer;
  if (
    statement.kind === "Assignment" &&
    statement.operator === "=" &&
    statement.target.kind === "Variable"
  )
    return statement.value;
  return null;
}

export function buildCodeNode(
  statement: Statement,
  context: CodeContext,
): {
  readonly node: CodeNode;
  readonly edges: readonly GraphEdge[];
  readonly writes: readonly PortSpec[];
} {
  const { scope, keys, text } = context;
  const { reads, writes } = statementVariables(statement);

  const inputs = new Map<string, Port>();
  const seen = new Set<string>();
  const wires: { variable: string; from: GraphEdge["from"]; type: FlowType }[] =
    [];
  for (const read of reads) {
    // `params` as a whole is not a value to wire (`params.x` is)
    if (read.name === "params" && read.properties.length === 0) continue;
    const resolved = scope.resolveRead(read);
    if (resolved === null) continue;
    if (!inputs.has(resolved.variable))
      inputs.set(resolved.variable, {
        id: resolved.variable,
        label: resolved.variable,
        type: null,
        argument: null,
        argumentType: null,
      });
    for (const s of resolved.sources) {
      const key = `${resolved.variable}\n${s.port.node}[${s.port.port}]`;
      if (seen.has(key)) continue;
      seen.add(key);
      wires.push({
        variable: resolved.variable,
        from: s.port,
        type: s.type ?? UNKNOWN,
      });
    }
  }

  const value = assignedValue(statement);
  const outputs = writes.map((w) =>
    spec(
      w.name,
      writes.length === 1 && value !== null ? context.typeOf(value) : null,
    ),
  );
  const first = writes[0];
  const id = first === undefined ? keys.code() : keys.assigned(first.name);

  const source = text.slice(statement.range.start, statement.range.end);
  const line = (source.split("\n").find((l) => l.trim() !== "") ?? "").trim();
  const node: CodeNode = {
    id,
    kind: "code",
    label:
      line.length > LABEL_LENGTH ? `${line.slice(0, LABEL_LENGTH - 1)}…` : line,
    inputs: [...inputs.values()],
    outputs: outputs.map((o) => ({
      id: o.id,
      label: o.label,
      type: o.type,
      argument: null,
      argumentType: null,
    })),
    range: statement.range,
    text: source,
  };
  const edges = wires.map((w) => ({
    id: `${w.from.node}[${w.from.port}] -> ${id}[${w.variable}]`,
    from: w.from,
    to: { node: id, port: w.variable },
    type: w.type,
    variable: w.variable,
    direct: false,
  }));
  return { node, edges, writes: outputs };
}
