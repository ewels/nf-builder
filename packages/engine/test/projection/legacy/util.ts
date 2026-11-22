import type { GraphEdge, GraphNode, Projection } from "@nf-builder/lang-core";
import { formatFlowType } from "../../../src/projection/types";
import { projectorForFiles } from "../open";

/** Projects the entry workflow (or `name`) of a one-file legacy project. */
export async function projectMain(
  text: string,
  extra: Record<string, string> = {},
  name: string | null = null,
): Promise<Projection> {
  const projector = await projectorForFiles({ "main.nf": text, ...extra });
  const p = projector.project("main.nf", name);
  if (p === null) throw new Error("no projection");
  return p;
}

export const ids = (p: Projection): string[] => p.nodes.map((n) => n.id);

export function node(p: Projection, id: string): GraphNode {
  const found = p.nodes.find((n) => n.id === id);
  if (found === undefined)
    throw new Error(`no node ${id}; have ${ids(p).join(", ")}`);
  return found;
}

/** The edges into a port as `node[port]` (with `~` when not direct) in order. */
export function into(p: Projection, id: string, port: string): string[] {
  return p.edges
    .filter((e: GraphEdge) => e.to.node === id && e.to.port === port)
    .map(
      (e) =>
        `${e.from.node.replace(/^main\.nf#[A-Za-z_]*\//, "")}[${e.from.port}]${e.direct ? "" : "~"}`,
    );
}

export const outType = (n: GraphNode, port: string): string => {
  const found = n.outputs.find((x) => x.id === port);
  return found?.type == null ? "-" : formatFlowType(found.type);
};

export const FOO = `process FOO {
    input:
    val x

    output:
    val x, emit: a
    path 'f.txt', emit: f

    script:
    "touch f.txt"
}
`;
