// The dry run behind "invalid targets dim while dragging" (UX-25, LA-29, F-302): for one dragged output port, what
// Connect would do to every input port of the workflow. Refusals come from `planConnect`, which makes every check
// Connect makes except the ones only the reprint finds; a type mismatch comes from the pack's `connection` check.
import type {
  FlowType,
  PackLints,
  PortRef,
  TypeExpr,
  WorkflowTarget,
} from "@nf-builder/lang-core";
import type { EditState } from "./apply";
import { planConnect } from "./commands/connect";
import { EditRefusal } from "./refusal";
import { locateWorkflow } from "./workflow";

/** `ok`, `mismatch` (allowed, but an error once connected, LA-29) or `refused` (Connect would refuse it). */
export type ConnectionStatus = "ok" | "mismatch" | "refused";

export interface ConnectionTarget {
  readonly node: string;
  readonly port: string;
  readonly status: ConnectionStatus;
  /** The refusal, or the type problem; null for `ok`. */
  readonly message: string | null;
}

const typeName = (type: TypeExpr): string =>
  `${type.name}${
    type.args.length === 0 ? "" : `<${type.args.map(typeName).join(", ")}>`
  }${type.nullable ? "?" : ""}`;
const flowName = (type: FlowType): string =>
  type.element === null ? "?" : typeName(type.element);

/** The status of connecting `from` to every input port of every node of the workflow, the source's own included (refused) `target`. */
export function connectionTargets(
  state: EditState,
  lints: PackLints,
  target: WorkflowTarget,
  from: PortRef,
): ConnectionTarget[] {
  const { file, projection } = locateWorkflow(state, target);
  const source = projection.nodes
    .find((n) => n.id === from.node)
    ?.outputs.find((p) => p.id === from.port);
  if (!source)
    throw new EditRefusal(
      "not-found",
      `There is no output ${from.port} on ${from.node}.`,
    );
  const isRecord = (name: string): boolean => {
    const found = state.model.lookup(file.path, name);
    const declaration =
      found?.kind === "declaration"
        ? found.declaration
        : found?.entry.declaration;
    return declaration?.kind === "Record";
  };
  const typed = file.ast?.typesEnabled === true;
  const out: ConnectionTarget[] = [];
  for (const node of projection.nodes) {
    for (const input of node.inputs) {
      const to = { node: node.id, port: input.id };
      try {
        planConnect(state, { kind: "connect", target, from, to });
      } catch (error) {
        if (!(error instanceof EditRefusal)) throw error;
        out.push({ ...to, status: "refused", message: error.message });
        continue;
      }
      const arity = typed ? lints.tupleArity(source.type, input) : null;
      if (arity)
        out.push({
          ...to,
          status: "mismatch",
          message: `A tuple with ${arity.actual} ${arity.actual === 1 ? "component" : "components"} is passed to ${input.label} of ${node.label}, which declares ${arity.expected}, so connecting it is an error.`,
        });
      else if (
        lints.connection(source.type, node, input, isRecord) === "incompatible"
      )
        out.push({
          ...to,
          status: "mismatch",
          message: `${source.type ? flowName(source.type) : "This value"} doesn't match the ${input.type ? flowName(input.type) : "declared"} type of ${input.label} on ${node.label}, so connecting it is a type error.`,
        });
      else out.push({ ...to, status: "ok", message: null });
    }
  }
  return out;
}
