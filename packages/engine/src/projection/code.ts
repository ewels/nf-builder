// A code node (AR-13, LA-27, ADR 0004): a statement the projection does not model, with ports from its free variables.
// Inputs are the free reads that resolve to graph values, one port per distinct reference; outputs are the variables the
// statement assigns, in first-write order.

import type {
  CodeNode,
  FlowType,
  GraphEdge,
  Port,
  Statement,
} from "@nf-builder/lang-core";
import { statementVariables } from "./free-variables";
import type { KeyAllocator } from "./keys";
import type { WorkflowScope } from "./scope";
import { UNKNOWN } from "./types";

interface CodeContext {
  readonly scope: WorkflowScope;
  readonly keys: KeyAllocator;
  /** The whole source text of the workflow's file. */
  readonly text: string;
  /** Whether the node is a code node: a property read from a code node's value is never one of its ports. */
  readonly isCode: (nodeId: string) => boolean;
  /** The type of the value a single assignment `x = e` or `def x = e` copies or computes; null for other statements. */
  readonly assignedType: () => FlowType | null;
}

const LABEL_LENGTH = 60;

const port = (id: string, type: FlowType | null): Port => ({
  id,
  label: id,
  type,
  argument: null,
  argumentType: null,
});

export function buildCodeNode(
  statement: Statement,
  context: CodeContext,
): {
  readonly node: Omit<CodeNode, "guards">;
  readonly edges: readonly GraphEdge[];
} {
  const { scope, keys, text } = context;
  const { reads, writes } = statementVariables(statement);
  const first = writes[0];
  const id = first === undefined ? keys.code() : keys.assigned(first.name);

  const edges = new Map<string, GraphEdge>();
  for (const read of reads) {
    // `params` as a whole is not a value to wire (`params.x` is)
    if (read.name === "params" && read.properties.length === 0) continue;
    // `x = [x: 1]; y = x.x`: the output port of a code node is named like the variable, but `.x` reads the value's property
    // a name that isn't bound (a callee read as `X.out.name`) has no code node value
    const values = scope.lookup(read.name);
    const whole =
      values.length > 0 && values.every((v) => context.isCode(v.node));
    const resolved = scope.resolveRead(
      whole ? { name: read.name, properties: [] } : read,
    );
    if (resolved === null) continue;
    const { variable } = resolved;
    for (const { port: from, type } of resolved.sources) {
      const edge = `${from.node}[${from.port}] -> ${id}[${variable}]`;
      if (!edges.has(edge))
        edges.set(edge, {
          id: edge,
          from,
          to: { node: id, port: variable },
          type: type ?? UNKNOWN,
          variable,
          direct: false,
        });
    }
  }
  const inputs = new Set([...edges.values()].map((e) => e.to.port));

  // with one write, the statement may be a single assignment to it
  const type = writes.length === 1 ? context.assignedType() : null;
  const source = text.slice(statement.range.start, statement.range.end);
  const line = (source.split("\n").find((l) => l.trim() !== "") ?? "").trim();
  const node: Omit<CodeNode, "guards"> = {
    id,
    kind: "code",
    label:
      line.length > LABEL_LENGTH ? `${line.slice(0, LABEL_LENGTH - 1)}…` : line,
    inputs: [...inputs].map((v) => port(v, null)),
    outputs: writes.map((w) => port(w.name, type)),
    range: statement.range,
    text: source,
  };
  return { node, edges: [...edges.values()] };
}
