// Range helpers shared by the details and problems views (F-206, F-309).
import type { GraphNode, Projection, Range } from "@nf-builder/lang-core";

/** True when `inner` lies inside `outer` (touching ends count). */
export const rangeContains = (
  outer: Pick<Range, "start" | "end">,
  inner: Pick<Range, "start" | "end">,
): boolean => inner.start >= outer.start && inner.end <= outer.end;

/** A params or output node without its block takes the whole workflow's range, which is not its own. */
export const spansWorkflow = (projection: Projection, node: GraphNode) =>
  (node.kind === "params" || node.kind === "output") &&
  node.range.start === projection.workflow.range.start &&
  node.range.end === projection.workflow.range.end;
