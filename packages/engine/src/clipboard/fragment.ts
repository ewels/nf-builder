// The nodes a copy carries (F-310, UX-26): the call nodes of one workflow with their definitions and the connections
// between them, as plain data that survives a close and an open of another project. It is the engine's own, never a
// stored or exported format; the clipboard holds it in the worker (AR-30).
import type { EditState } from "../edit/apply";
import { EditRefusal } from "../edit/refusal";
import { graphNode, locateWorkflow } from "../edit/workflow";
import type { Point, Positions } from "../layout";

/** IO-12 for one file, and the limits of one copy (1 MB is 1,000,000 bytes). */
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_FILES = 200;
export const MAX_TOTAL_BYTES = 5_000_000;

export interface CopyRequest {
  /** The workflow the nodes are in. */
  readonly path: string;
  readonly workflow: string | null;
  /** Projection node ids. */
  readonly nodes: readonly string[];
  /** Where the page shows the nodes (node ids to top-left corners), for the offsets between them. */
  readonly positions: Positions;
}

export interface FragmentNode {
  /** The node's id in the source project. */
  readonly source: string;
  /** The declared name of the process or workflow (not the alias it was called by). */
  readonly callee: string;
  readonly kind: "process" | "workflow";
  /** The project path of the file that declares it. */
  readonly definition: string;
  /** The definition sits in the file of the workflow it was copied from, so there is no file to copy. */
  readonly inline: boolean;
  /** Distance from the top-left corner of the copied nodes. */
  readonly offset: Point;
}

export interface FragmentPort {
  /** The source id of a copied node. */
  readonly node: string;
  readonly port: string;
}

export interface FragmentEdge {
  readonly from: FragmentPort;
  readonly to: FragmentPort;
}

export interface FragmentFile {
  readonly path: string;
  readonly text: string;
}

export interface NodeFragment {
  readonly languageVersion: string;
  readonly nodes: readonly FragmentNode[];
  readonly edges: readonly FragmentEdge[];
  readonly files: readonly FragmentFile[];
}

/** What the page may know about the clipboard: no file text (AR-30). */
export interface ClipboardSummary {
  readonly nodes: number;
  readonly connections: number;
  readonly labels: readonly string[];
  readonly languageVersion: string;
}

export const summarise = (f: NodeFragment): ClipboardSummary => ({
  nodes: f.nodes.length,
  connections: f.edges.length,
  labels: f.nodes.map((n) => n.callee),
  languageVersion: f.languageVersion,
});

const invalid = (message: string, path?: string) =>
  new EditRefusal("invalid", message, path);

const bytes = (text: string): number => new TextEncoder().encode(text).length;

const isModuleMain = (path: string): boolean =>
  /^(modules|subworkflows)\/(.+\/)?main\.nf$/.test(path);

/**
 * The files a copy carries: each definition's file and, transitively, the project files it includes; for a
 * `main.nf` under `modules/` or `subworkflows/`, everything else in its directory too (`meta.yml`, `environment.yml`,
 * `templates/`), as nf-core lays them out.
 */
function collectFiles(
  state: EditState,
  definitions: readonly string[],
): FragmentFile[] {
  const paths = new Set<string>();
  const add = (path: string) => {
    if (paths.has(path)) return;
    paths.add(path);
    const includes = state.model.file(path)?.includes ?? [];
    for (const include of includes)
      if (include.kind === "script" && include.target.kind === "file")
        add(include.target.path);
  };
  for (const path of definitions) {
    add(path);
    if (isModuleMain(path)) {
      const dir = path.slice(0, path.lastIndexOf("/") + 1);
      for (const other of state.model.paths())
        if (other.startsWith(dir)) add(other);
    }
  }
  const files: FragmentFile[] = [];
  let total = 0;
  for (const path of [...paths].sort()) {
    const text = state.model.file(path)?.source.text;
    if (text === undefined) continue;
    const size = bytes(text);
    if (size > MAX_FILE_BYTES)
      throw invalid(
        `${path} is larger than 1 MB, so the nodes that use it can't be copied.`,
        path,
      );
    total += size;
    files.push({ path, text });
  }
  if (files.length > MAX_FILES || total > MAX_TOTAL_BYTES)
    throw invalid(
      `These nodes come with ${files.length} files (${(total / 1_000_000).toFixed(1)} MB). A copy can carry at most ${MAX_FILES} files and 5 MB.`,
    );
  return files;
}

/**
 * Builds the fragment of the selected call nodes of a workflow: the nodes with their offsets, the direct connections
 * between them by port id, and the files of their definitions. Connections to nodes outside the selection are
 * dropped. Refuses a node that isn't a process or workflow call, or whose definition isn't a file of the project.
 */
export function buildFragment(
  state: EditState,
  request: CopyRequest,
  languageVersion: string,
): NodeFragment {
  const { projection } = locateWorkflow(state, {
    path: request.path,
    workflow: request.workflow,
  });
  const ids = [...new Set(request.nodes)];
  if (ids.length === 0)
    throw invalid("Select at least one process or workflow call to copy.");
  for (const id of ids) graphNode(projection, id);
  // in the order the workflow shows them, so a paste calls them in that order
  const nodes = projection.nodes.filter((n) => ids.includes(n.id));
  const fragmentNodes: Omit<FragmentNode, "offset">[] = [];
  for (const node of nodes) {
    if (node.kind !== "call")
      throw invalid(
        `${node.label} can't be copied yet: only process and workflow calls can.`,
      );
    const { callee } = node;
    if (
      (callee.kind !== "process" && callee.kind !== "workflow") ||
      callee.path === null ||
      callee.status === "unresolved"
    )
      throw invalid(
        `${callee.name} can't be copied: it isn't a process or workflow defined in a file of this project.`,
      );
    const binding = state.model.lookup(request.path, callee.name);
    const declared =
      binding?.kind === "include" ? binding.entry.entry.name.name : callee.name;
    fragmentNodes.push({
      source: node.id,
      callee: declared,
      kind: callee.kind,
      definition: callee.path,
      inline: callee.path === request.path,
    });
  }
  const copied = new Set(ids);
  const edges: FragmentEdge[] = projection.edges
    .filter((e) => e.direct && copied.has(e.from.node) && copied.has(e.to.node))
    .map((e) => ({
      from: { node: e.from.node, port: e.from.port },
      to: { node: e.to.node, port: e.to.port },
    }));
  // offsets from the top-left corner of the nodes that have a position
  const placed = ids.flatMap((id) => request.positions[id] ?? []);
  const left = Math.min(...placed.map((p) => p.x));
  const top = Math.min(...placed.map((p) => p.y));
  const offsetOf = (id: string): Point => {
    const p = request.positions[id];
    return p ? { x: p.x - left, y: p.y - top } : { x: 0, y: 0 };
  };
  return {
    languageVersion,
    nodes: fragmentNodes.map((n) => ({ ...n, offset: offsetOf(n.source) })),
    edges,
    files: collectFiles(
      state,
      fragmentNodes.filter((n) => !n.inline).map((n) => n.definition),
    ),
  };
}
