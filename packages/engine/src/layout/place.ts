// Placing nodes that have no stored position (ADR 0008, F-207). Pure: this builds the graph ELK lays out and merges its
// answer with the positions already stored. elkjs itself runs in a worker in apps/web; the types here are plain JSON.

import { CANVAS_METRICS, portY } from "../canvas/metrics";
import type { CanvasNodeView, CanvasView } from "../canvas/types";
import type { Point, Positions } from "./types";

export interface ElkPortIn {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: 0;
  readonly height: 0;
  readonly layoutOptions: Readonly<Record<string, string>>;
}

export interface ElkNodeIn {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly ports: readonly ElkPortIn[];
  readonly layoutOptions?: Readonly<Record<string, string>>;
}

export interface ElkEdgeIn {
  readonly id: string;
  readonly sources: readonly string[];
  readonly targets: readonly string[];
}

export interface ElkGraphIn {
  readonly id: "root";
  readonly layoutOptions: Readonly<Record<string, string>>;
  readonly children: readonly ElkNodeIn[];
  readonly edges: readonly ElkEdgeIn[];
}

/** The part of ELK's answer used here. */
export interface ElkGraphOut {
  readonly children?: readonly {
    readonly id: string;
    readonly x?: number;
    readonly y?: number;
  }[];
}

/** Option ids as listed in the ELK reference (eclipse.dev/elk) and registered in elkjs 0.12. */
export const ELK_LAYOUT_OPTIONS: Readonly<Record<string, string>> = {
  "org.eclipse.elk.algorithm": "layered",
  "org.eclipse.elk.direction": "RIGHT",
  "org.eclipse.elk.spacing.nodeNode": String(CANVAS_METRICS.rowGap),
  "org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers": String(
    CANVAS_METRICS.columnGap,
  ),
  "org.eclipse.elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
};

const LAYER = "org.eclipse.elk.layered.layering.layerConstraint";
const SIDE = "org.eclipse.elk.port.side";
const INDEX = "org.eclipse.elk.port.index";

const portId = (node: string, side: "in" | "out", port: string) =>
  `${node}\u0000${side}\u0000${port}`;

function elkNode(node: CanvasNodeView): ElkNodeIn {
  const port =
    (side: "in" | "out") =>
    (p: { id: string }, i: number): ElkPortIn => ({
      id: portId(node.id, side, p.id),
      x: side === "in" ? 0 : node.width,
      y: portY(node, i),
      width: 0,
      height: 0,
      layoutOptions: {
        [SIDE]: side === "in" ? "WEST" : "EAST",
        [INDEX]: String(i),
      },
    });
  const ports = [
    ...node.inputs.map(port("in")),
    ...node.outputs.map(port("out")),
  ];
  const first = node.kind === "take" || node.kind === "params";
  const last = node.kind === "emit" || node.kind === "output";
  return {
    id: node.id,
    width: node.width,
    height: node.height,
    ports,
    layoutOptions: {
      "org.eclipse.elk.portConstraints": "FIXED_ORDER",
      ...(first ? { [LAYER]: "FIRST" } : last ? { [LAYER]: "LAST" } : {}),
    },
  };
}

/** The ELK input for `view`, or only for the nodes in `only` and the edges between them. */
export function elkGraph(
  view: CanvasView,
  only?: ReadonlySet<string>,
): ElkGraphIn {
  const nodes = view.nodes.filter((n) => only === undefined || only.has(n.id));
  const ids = new Set(nodes.map((n) => n.id));
  return {
    id: "root",
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: nodes.map(elkNode),
    edges: view.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        id: e.id,
        sources: [portId(e.source, "out", e.sourcePort)],
        targets: [portId(e.target, "in", e.targetPort)],
      })),
  };
}

/** The top-left corner ELK gave each child; children without a position are left out. */
export function elkPositions(out: ElkGraphOut): Positions {
  const positions: Record<string, Point> = {};
  for (const c of out.children ?? [])
    if (c.x !== undefined && c.y !== undefined)
      positions[c.id] = { x: c.x, y: c.y };
  return positions;
}

/** The view's nodes that have no stored position, in view order. */
export function unplaced(
  view: CanvasView,
  stored: Positions,
): readonly string[] {
  return view.nodes.filter((n) => stored[n.id] === undefined).map((n) => n.id);
}

const ORIGIN: Point = { x: 0, y: 0 };

/**
 * Positions for every node of `view`. Stored positions never move. With none stored, ELK's positions are used.
 * Otherwise each unplaced node keeps ELK's offset from its first placed neighbour (those that feed it first); one with
 * no placed neighbour goes below the placed nodes, keeping ELK's x; finally nodes are pushed down until none overlap.
 */
export function placeNodes(
  view: CanvasView,
  stored: Positions,
  elk: Positions,
): Positions {
  const result: Record<string, Point> = {};
  const fresh: string[] = [];
  for (const n of view.nodes) {
    const at = stored[n.id];
    if (at !== undefined) result[n.id] = at;
    else fresh.push(n.id);
  }
  if (fresh.length === 0) return result;
  const elkAt = (id: string) => elk[id] ?? ORIGIN;
  if (fresh.length === view.nodes.length) {
    for (const id of fresh) result[id] = elkAt(id);
    return result;
  }

  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = neighbours.get(to);
    if (list) list.push(from);
    else neighbours.set(to, [from]);
  };
  // sources first: for a node, the nodes feeding it come before those it feeds
  for (const e of view.edges)
    if (e.source !== e.target) link(e.source, e.target);
  for (const e of view.edges)
    if (e.source !== e.target) link(e.target, e.source);

  const pending = new Set(fresh);
  for (let progress = true; progress && pending.size > 0; ) {
    progress = false;
    for (const id of fresh) {
      if (!pending.has(id)) continue;
      const anchor = (neighbours.get(id) ?? []).find(
        (m) => result[m] !== undefined && !pending.has(m),
      );
      if (anchor === undefined) continue;
      const a = result[anchor] as Point;
      result[id] = {
        x: a.x + elkAt(id).x - elkAt(anchor).x,
        y: a.y + elkAt(id).y - elkAt(anchor).y,
      };
      pending.delete(id);
      progress = true;
    }
  }

  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  if (pending.size > 0) {
    const bottom = Math.max(
      ...view.nodes
        .filter((n) => result[n.id] !== undefined)
        .map((n) => (result[n.id] as Point).y + n.height),
    );
    const top = Math.min(...[...pending].map((id) => elkAt(id).y));
    for (const id of fresh) {
      if (!pending.has(id)) continue;
      result[id] = {
        x: elkAt(id).x,
        y: bottom + CANVAS_METRICS.rowGap + elkAt(id).y - top,
      };
    }
  }

  // clear overlaps, moving only the nodes placed here and only downwards
  const gap = CANVAS_METRICS.rowGap;
  const done: CanvasNodeView[] = view.nodes.filter(
    (n) => stored[n.id] !== undefined,
  );
  for (const id of fresh) {
    const n = byId.get(id) as CanvasNodeView;
    const at = result[id] as Point;
    let y = at.y;
    for (let moved = true; moved; ) {
      moved = false;
      for (const other of done) {
        const o = result[other.id] as Point;
        if (
          at.x < o.x + other.width + gap &&
          o.x < at.x + n.width + gap &&
          y < o.y + other.height + gap &&
          o.y < y + n.height + gap
        ) {
          y = o.y + other.height + gap;
          moved = true;
        }
      }
    }
    result[id] = { x: at.x, y };
    done.push(n);
  }
  return result;
}

/**
 * Moves only the nodes in `ids` to ELK's arrangement of them (`elk` comes from `elkGraph(view, ids)`), translated so the
 * selection keeps its top-left corner. Returns the positions of every node of the view.
 */
export function layoutSelection(
  view: CanvasView,
  current: Positions,
  ids: ReadonlySet<string>,
  elk: Positions,
): Positions {
  const result: Record<string, Point> = {};
  const chosen = view.nodes.filter((n) => ids.has(n.id) && elk[n.id]);
  const now = (n: CanvasNodeView): Point => current[n.id] ?? { x: n.x, y: n.y };
  for (const n of view.nodes) result[n.id] = now(n);
  if (chosen.length === 0) return result;
  const minX = Math.min(...chosen.map((n) => now(n).x));
  const minY = Math.min(...chosen.map((n) => now(n).y));
  const elkX = Math.min(...chosen.map((n) => (elk[n.id] as Point).x));
  const elkY = Math.min(...chosen.map((n) => (elk[n.id] as Point).y));
  for (const n of chosen) {
    const e = elk[n.id] as Point;
    result[n.id] = { x: minX + e.x - elkX, y: minY + e.y - elkY };
  }
  return result;
}

/** `view` with the given positions applied to its nodes. */
export function withPositions(
  view: CanvasView,
  positions: Positions,
): CanvasView {
  return {
    nodes: view.nodes.map((n) => {
      const at = positions[n.id];
      return at === undefined ? n : { ...n, x: at.x, y: at.y };
    }),
    edges: view.edges,
  };
}
