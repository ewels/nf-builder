// What the canvas does with ELK (F-207, ADR 0008, UX-26): place the nodes that have no stored position, and re-run the
// layout on request. Pure but for the injected runner, so it is tested with a fake one. Sizes are taken with port labels
// shown, so turning labels off never causes overlaps.
import {
  canvasView,
  elkGraph,
  elkPositions,
  layoutSelection,
  type Point,
  type Positions,
  type Projection,
  placeNodes,
  unplaced,
} from "@nf-builder/engine";
import type { ElkRunner } from "./elk-client";

export interface PlaceResult {
  /** Every node of the projection. */
  readonly positions: Positions;
  /** The positions to save: only the nodes placed here, none when ELK failed. */
  readonly added: Positions;
  readonly notice: string | null;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function placeMissing(
  projection: Projection,
  stored: Positions,
  elk: ElkRunner,
): Promise<PlaceResult> {
  const view = canvasView(projection, { portLabels: true });
  const missing = unplaced(view, stored);
  if (missing.length === 0)
    return { positions: placeNodes(view, stored, {}), added: {}, notice: null };
  try {
    const positions = placeNodes(
      view,
      stored,
      elkPositions(await elk(elkGraph(view))),
    );
    const added: Record<string, Point> = {};
    for (const id of missing) added[id] = positions[id] as Point;
    return { positions, added, notice: null };
  } catch (error) {
    // F-205's columns, which the view already holds
    const columns: Record<string, Point> = {};
    for (const n of view.nodes) columns[n.id] = { x: n.x, y: n.y };
    return {
      positions: placeNodes(view, stored, columns),
      added: {},
      notice: `Automatic layout isn't available (${messageOf(error)}). Nodes are placed in columns.`,
    };
  }
}

/**
 * Two or more selected nodes: ELK on the induced subgraph, moving only them (their top-left corner stays). Otherwise ELK
 * on every node, which replaces the workflow's stored positions. Rejects when ELK fails.
 */
export async function autoLayout(
  projection: Projection,
  current: Positions,
  selected: readonly string[],
  elk: ElkRunner,
): Promise<{ positions: Positions; replace: boolean }> {
  const view = canvasView(projection, { portLabels: true });
  if (selected.length >= 2) {
    const ids = new Set(selected);
    const out = elkPositions(await elk(elkGraph(view, ids)));
    return {
      positions: layoutSelection(view, current, ids, out),
      replace: false,
    };
  }
  const out = elkPositions(await elk(elkGraph(view)));
  return { positions: placeNodes(view, {}, out), replace: true };
}
