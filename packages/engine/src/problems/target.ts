import type {
  Diagnostic,
  Projection,
  Range,
  WorkflowRef,
} from "@nf-builder/lang-core";
import { rangeContains, spansWorkflow } from "../details/node-range";
import type { ProblemTarget } from "./types";

/** Where activating a problem goes: its workflow (inside it or not) or, for a file without workflows, a file tab. */
export function problemTarget(
  d: Diagnostic,
  workflows: readonly WorkflowRef[],
): ProblemTarget {
  const here = workflows.filter((w) => w.path === d.path);
  const containing = here.find((w) => rangeContains(w.range, d.range));
  if (containing)
    return {
      kind: "workflow",
      path: d.path,
      workflow: containing.name,
      inside: true,
    };
  const fallback = here.find((w) => w.name === null) ?? here[0];
  if (fallback)
    return {
      kind: "workflow",
      path: d.path,
      workflow: fallback.name,
      inside: false,
    };
  return { kind: "file", path: d.path };
}

/** The id of the innermost node of the projection whose range contains `range`, never a node spanning the workflow. */
export function nodeAtRange(
  projection: Projection,
  path: string,
  range: Pick<Range, "start" | "end">,
): string | null {
  if (projection.workflow.path !== path) return null;
  let best: { id: string; size: number } | null = null;
  for (const node of projection.nodes) {
    if (spansWorkflow(projection, node) || !rangeContains(node.range, range))
      continue;
    const size = node.range.end - node.range.start;
    if (best === null || size < best.size) best = { id: node.id, size };
  }
  return best?.id ?? null;
}
