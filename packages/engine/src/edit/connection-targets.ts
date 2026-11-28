// The dry run behind "invalid targets dim while dragging" (UX-25, LA-29, F-302): for one dragged output port, what
// Connect would do to every input port of the workflow. Refusals come from `planConnect`, which makes every check
// Connect makes except the ones only the reprint finds; a type mismatch comes from the pack's `connection` check.
import type {
  FlowType,
  GraphNode,
  PackLints,
  Port,
  PortRef,
  WorkflowDef,
  WorkflowTarget,
} from "@nf-builder/lang-core";
import { formatType } from "../projection/types";
import type { EditState } from "./apply";
import { type ConnectPlan, planConnect } from "./commands/connect";
import { findByRange } from "./nodes";
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

const flowName = (type: FlowType): string =>
  type.element === null ? "?" : formatType(type.element);

/**
 * Whether the lint rules would check the call's arguments once `input` is connected: nf-lang checks them only when
 * their number is right, so a connection that leaves the count wrong shows no red edge (LA-32). Replacing an argument
 * keeps the count; filling a free input pads the earlier ones with `null`.
 */
function checkedAfterConnect(
  def: WorkflowDef,
  node: GraphNode,
  input: Port,
): boolean {
  if (node.kind !== "call") return true;
  const call = findByRange(def, node.range);
  if (call?.kind !== "MethodCall") return true;
  const positional = call.args.filter((a) => a.kind !== "NamedArgument").length;
  const named = call.args.some((a) => a.kind === "NamedArgument") ? 1 : 0;
  const grown = input.argument
    ? positional
    : Math.max(positional, node.inputs.indexOf(input) + 1);
  return grown + named + call.closures.length === node.inputs.length;
}

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
      let plan: ConnectPlan;
      try {
        plan = planConnect(state, { kind: "connect", target, from, to });
      } catch (error) {
        if (!(error instanceof EditRefusal)) throw error;
        out.push({ ...to, status: "refused", message: error.message });
        continue;
      }
      if (!checkedAfterConnect(plan.def, node, input)) {
        out.push({ ...to, status: "ok", message: null });
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
