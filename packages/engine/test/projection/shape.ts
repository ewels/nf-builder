import type { Projection } from "@nf-builder/lang-core";
import type { Projector } from "../../src/projection/project";

/** What must survive a whitespace-only change: ids, kinds, labels, ports, edges. Ranges are left out. */
export function shape(projection: Projection) {
  const { workflow } = projection;
  return {
    workflow: { ...workflow, range: undefined },
    nodes: projection.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      extra:
        n.kind === "call"
          ? n.callee
          : n.kind === "chain"
            ? n.steps.map((s) => [s.operator, s.known])
            : n.kind === "factory"
              ? [n.namespace, n.factory]
              : n.kind === "take" || n.kind === "emit"
                ? n.name
                : null,
      inputs: n.inputs.map((p) => [p.id, p.label, p.type, p.argumentType]),
      outputs: n.outputs.map((p) => [p.id, p.label, p.type, p.argumentType]),
    })),
    edges: projection.edges.map((e) => [
      e.from,
      e.to,
      e.type,
      e.variable,
      e.direct,
    ]),
  };
}

export function shapes(projector: Projector) {
  return projector.workflows().map((ref) => {
    const p = projector.project(ref.path, ref.name);
    return {
      ref: { ...ref, range: undefined },
      shape: p === null ? null : shape(p),
    };
  });
}
