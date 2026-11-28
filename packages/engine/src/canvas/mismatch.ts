import type { Diagnostic, Projection, Range } from "@nf-builder/lang-core";

/** The diagnostic codes that put an edge in the error colour (LA-32, LA-14). */
export const MISMATCH_CODES: readonly string[] = [
  "type-mismatch",
  "tuple-arity",
];

const contains = (outer: Range, inner: Range): boolean =>
  outer.start <= inner.start && inner.end <= outer.end;

/**
 * Edge id to the message of the mismatch diagnostic on its target port's argument (F-302, UX-24): the diagnostic's
 * range equals the argument (a call) or contains it (an emit or output item). Every edge into that port is marked.
 */
export function edgeMismatches(
  projection: Projection,
  diagnostics: readonly Diagnostic[],
): ReadonlyMap<string, string> {
  const here = diagnostics.filter(
    (d) =>
      d.path === projection.workflow.path && MISMATCH_CODES.includes(d.code),
  );
  const marks = new Map<string, string>();
  if (here.length === 0) return marks;
  const nodes = new Map(projection.nodes.map((n) => [n.id, n]));
  for (const edge of projection.edges) {
    const argument = nodes
      .get(edge.to.node)
      ?.inputs.find((p) => p.id === edge.to.port)?.argument;
    if (argument === null || argument === undefined) continue;
    const found = here.find((d) => contains(d.range, argument));
    if (found !== undefined) marks.set(edge.id, found.message);
  }
  return marks;
}
