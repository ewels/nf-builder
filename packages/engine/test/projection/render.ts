import type { Projection } from "@nf-builder/lang-core";
import { formatFlowType } from "../../src/projection/types";

const type = (t: Parameters<typeof formatFlowType>[0] | null): string =>
  t === null ? "-" : formatFlowType(t);

/**
 * One line per node (id, kind, label, callee, position), one line per port with its type, and each edge under its
 * target port as `<- node[port] Type via variable` (`indirect` when not direct). An inline argument shows its text.
 * The header counts the statements and the modelled ones; a node under an `if` has a `guards` line, and a statement
 * that made no node has a `bound` line.
 */
export function renderProjection(projection: Projection, text: string): string {
  const lines: string[] = [];
  const w = projection.workflow;
  lines.push(
    `workflow ${w.path}#${w.name ?? ""} ${w.typed === null ? "?" : w.typed ? "typed" : "legacy"}`,
  );
  const modelled = projection.statements.filter((s) => s.modelled).length;
  lines.push(
    `statements ${projection.statements.length}, modelled ${modelled}`,
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
    if (node.guards.length > 0)
      lines.push(
        `  guards ${node.guards.map((g) => `${g.branch} of ${text.slice(g.condition.start, g.condition.end)}`).join("; ")}`,
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
  // statements that made no node (aliases, `def x`) would otherwise leave no trace
  for (const s of projection.statements)
    if (s.nodes.length === 0)
      lines.push(
        `bound @${s.range.line}:${s.range.column} ${s.binds.join(", ") || "-"}`,
      );
  return `${lines.join("\n")}\n`;
}
