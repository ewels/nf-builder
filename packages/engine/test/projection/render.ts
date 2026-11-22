import type { Projection } from "@nf-builder/lang-core";
import { formatFlowType } from "../../src/projection/types";

const type = (t: Parameters<typeof formatFlowType>[0] | null): string =>
  t === null ? "-" : formatFlowType(t);

/**
 * One line per node (id, kind, label, callee, position), one line per port with its type, and each edge under its
 * target port as `<- node[port] Type via variable` (`indirect` when not direct). An inline argument shows its text.
 */
export function renderProjection(projection: Projection, text: string): string {
  const lines: string[] = [];
  const w = projection.workflow;
  lines.push(
    `workflow ${w.path}#${w.name ?? ""} ${w.typed === null ? "?" : w.typed ? "typed" : "legacy"}`,
  );
  for (const node of projection.nodes) {
    const extra =
      node.kind === "call"
        ? ` callee=${node.callee.name}:${node.callee.kind ?? "?"}:${node.callee.status}${node.callee.typed === null ? "" : node.callee.typed ? ":typed" : ":legacy"}`
        : node.kind === "chain"
          ? ` steps=${node.steps.map((s) => s.operator).join(",")}`
          : node.kind === "factory"
            ? ` factory=${node.namespace}.${node.factory}`
            : "";
    lines.push(
      `${node.id} ${node.kind} "${node.label}"${extra} @${node.range.line}:${node.range.column}`,
    );
    for (const port of node.inputs) {
      lines.push(`  in ${port.id} (${port.label}): ${type(port.type)}`);
      if (port.argument !== null && port.argumentType !== null)
        lines.push(
          `    = ${text.slice(port.argument.start, port.argument.end)} : ${type(port.argumentType)}`,
        );
      for (const edge of projection.edges)
        if (edge.to.node === node.id && edge.to.port === port.id)
          lines.push(
            `    <- ${edge.from.node}[${edge.from.port}] ${formatFlowType(edge.type)}${edge.variable === null ? "" : ` via ${edge.variable}`}${edge.direct ? "" : " indirect"}`,
          );
    }
    for (const port of node.outputs)
      lines.push(`  out ${port.id} (${port.label}): ${type(port.type)}`);
  }
  return `${lines.join("\n")}\n`;
}
