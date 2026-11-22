// The interim layered layout (F-205); F-207 replaces it with saved positions and ELK (ADR 0008). Deterministic, O(N+E).

import type { GraphNodeKind } from "@nf-builder/lang-core";
import { CANVAS_METRICS } from "./metrics";

export interface LayoutNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly width: number;
  readonly height: number;
}

/**
 * Columns by longest path (Kahn's algorithm; on a cycle the earliest unprocessed node goes next and its unprocessed
 * in-edges are ignored). Take nodes sit in the first column, emit and output nodes in the last; nodes in a column keep
 * input order and are centred vertically.
 */
export function layeredLayout(
  nodes: readonly LayoutNode[],
  edges: readonly { source: string; target: string }[],
): ReadonlyMap<string, { x: number; y: number }> {
  const index = new Map<string, number>();
  nodes.forEach((n, i) => {
    index.set(n.id, i);
  });
  const out: number[][] = nodes.map(() => []);
  const indegree: number[] = nodes.map(() => 0);
  for (const e of edges) {
    const s = index.get(e.source);
    const t = index.get(e.target);
    if (s === undefined || t === undefined || s === t) continue;
    out[s]?.push(t);
    indegree[t] = (indegree[t] ?? 0) + 1;
  }
  const rank: number[] = nodes.map(() => 0);
  const done: boolean[] = nodes.map(() => false);
  const queue: number[] = [];
  indegree.forEach((d, i) => {
    if (d === 0) queue.push(i);
  });
  let head = 0;
  let scan = 0;
  for (let processed = 0; processed < nodes.length; processed++) {
    let n: number;
    if (head < queue.length) n = queue[head++] as number;
    else {
      while (done[scan]) scan++;
      n = scan;
    }
    done[n] = true;
    for (const m of out[n] ?? []) {
      if (done[m]) continue;
      rank[m] = Math.max(rank[m] ?? 0, (rank[n] ?? 0) + 1);
      indegree[m] = (indegree[m] ?? 0) - 1;
      if (indegree[m] === 0) queue.push(m);
    }
  }
  const isLast = (n: LayoutNode) => n.kind === "emit" || n.kind === "output";
  let deepest = -1;
  nodes.forEach((n, i) => {
    if (n.kind === "take") {
      rank[i] = 0;
      deepest = Math.max(deepest, 0);
    } else if (!isLast(n)) deepest = Math.max(deepest, rank[i] ?? 0);
  });
  nodes.forEach((n, i) => {
    if (isLast(n)) rank[i] = deepest + 1;
  });

  const columns: number[][] = [];
  rank.forEach((r, i) => {
    let column = columns[r];
    if (column === undefined) column = columns[r] = [];
    column.push(i);
  });
  const { columnGap, rowGap } = CANVAS_METRICS;
  const heights = columns.map((c) =>
    c.reduce(
      (sum, i, k) => sum + (nodes[i]?.height ?? 0) + (k > 0 ? rowGap : 0),
      0,
    ),
  );
  const tallest = Math.max(0, ...heights);
  const positions = new Map<string, { x: number; y: number }>();
  let x = 0;
  columns.forEach((column, c) => {
    let y = Math.round((tallest - (heights[c] ?? 0)) / 2);
    let width = 0;
    for (const i of column) {
      const n = nodes[i];
      if (n === undefined) continue;
      positions.set(n.id, { x, y });
      y += n.height + rowGap;
      width = Math.max(width, n.width);
    }
    x += width + columnGap;
  });
  return positions;
}
