// Opening a workflow from a call node, and the call path to a workflow (F-307, UX-50). Pure; it reads the project model
// and the projections the caller supplies.
import type { Projection, WorkflowRef } from "@nf-builder/lang-core";
import { resolveCallee } from "./details/declaration";
import type { ProjectModel } from "./model/project";

/** Why a call node has no canvas to open. */
interface CalleeRefusal {
  readonly ok: false;
  readonly message: string;
}

const refuse = (message: string): CalleeRefusal => ({ ok: false, message });

const workflowKey = (w: { path: string; name: string | null }): string =>
  `${w.path}#${w.name ?? ""}`;

/**
 * The workflow a call node stands for: the definition, even when the call goes through an alias (`include { A as B }`),
 * and for a pipeline the entry workflow of its script. A process, an unresolved or unparsed callee and a plugin's
 * are refused with what to tell the user.
 */
export function calleeWorkflow(
  model: ProjectModel,
  projection: Projection,
  node: string,
  workflows: readonly WorkflowRef[],
): WorkflowRef | CalleeRefusal {
  const graphNode = projection.nodes.find((n) => n.id === node);
  if (graphNode?.kind !== "call")
    return refuse("This node isn't a call, so it has no canvas.");
  const { callee } = graphNode;
  const unparsed = refuse(
    `${callee.name} couldn't be parsed, so there is no canvas to show.`,
  );
  const undefinedHere = refuse(
    `${callee.name} isn't defined in this project, so it has no canvas.`,
  );
  if (callee.status === "unresolved") return undefinedHere;
  if (callee.status === "unparsed") return unparsed;
  if (callee.kind === "process") return refuse(`${callee.name} is a process.`);
  if (callee.kind === "agent") return refuse(`${callee.name} is an agent.`);
  const resolved = resolveCallee(model, projection.workflow.path, callee.name);
  if (resolved === null || resolved.path === null) return undefinedHere;
  const declaration = resolved.declaration;
  if (declaration?.kind !== "Workflow") return unparsed;
  const found = workflows.find(
    (w) =>
      w.path === resolved.path && w.name === (declaration.name?.name ?? null),
  );
  return found?.modelled ? found : unparsed;
}

/** The project's default workflow: main.nf's entry, else the first entry workflow, else the first one. */
export function defaultWorkflowRef(
  workflows: readonly WorkflowRef[],
): WorkflowRef | null {
  return (
    workflows.find((w) => w.name === null && w.path === "main.nf") ??
    workflows.find((w) => w.name === null) ??
    workflows[0] ??
    null
  );
}

/**
 * The shortest chain of calls from `from` to `to`, found breadth first: `from` and each workflow on the way, without
 * `to`. Empty when they are the same workflow; null when `to` is not reachable. A workflow is visited once, so
 * recursion ends.
 */
export function callPath(
  model: ProjectModel,
  project: (ref: WorkflowRef) => Projection | null,
  workflows: readonly WorkflowRef[],
  from: WorkflowRef,
  to: WorkflowRef,
): WorkflowRef[] | null {
  const target = workflowKey(to);
  const seen = new Set([workflowKey(from)]);
  let queue: { ref: WorkflowRef; path: WorkflowRef[] }[] = [
    { ref: from, path: [] },
  ];
  while (queue.length > 0) {
    const next: typeof queue = [];
    for (const { ref, path } of queue) {
      if (workflowKey(ref) === target) return path;
      const projection = project(ref);
      if (!projection) continue;
      for (const node of projection.nodes) {
        if (node.kind !== "call") continue;
        const callee = calleeWorkflow(model, projection, node.id, workflows);
        if ("ok" in callee || seen.has(workflowKey(callee))) continue;
        seen.add(workflowKey(callee));
        next.push({ ref: callee, path: [...path, ref] });
      }
    }
    queue = next;
  }
  return null;
}
