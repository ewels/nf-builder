import type { ElkGraphIn, ElkGraphOut, Positions } from "@nf-builder/engine";
import { canvasView } from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import {
  autoLayout,
  placedNodes,
  placeMissing,
} from "../src/layout/layout-flow";
import { entryProjection } from "./f111-fixture";

/** A fake ELK: node i goes to (1000 + 100 i, 50 i); records the graphs it was given. */
function fakeElk() {
  const graphs: ElkGraphIn[] = [];
  const run = async (graph: ElkGraphIn): Promise<ElkGraphOut> => {
    graphs.push(graph);
    return {
      children: graph.children.map((c, i) => ({
        id: c.id,
        x: 1000 + 100 * i,
        y: 50 * i,
      })),
    };
  };
  return { run, graphs };
}

describe("F-207 layout flow", () => {
  it("F-207 ADR-0008: nodes without a position are held back while ELK runs, the placed ones keep drawing at their positions, and a first open draws none", async () => {
    const projection = await entryProjection();
    const view = canvasView(projection, { portLabels: true });
    const [kept, second] = view.nodes.map((n) => n.id) as [string, string];
    const stored: Positions = { [kept]: { x: 7, y: 9 } };
    const partial = placedNodes(view, stored);
    expect(partial.nodes.map((n) => [n.id, n.x, n.y])).toEqual([[kept, 7, 9]]);
    expect(partial.nodes.some((n) => n.id === second)).toBe(false);
    expect(placedNodes(view, {}).nodes).toEqual([]);
    const all = Object.fromEntries(
      view.nodes.map((n) => [n.id, { x: 1, y: 2 }]),
    );
    expect(placedNodes(view, all).nodes).toHaveLength(view.nodes.length);
  });

  it("F-207 ADR-0008: only nodes without positions are laid out, and only they are returned for saving", async () => {
    const projection = await entryProjection();
    const [kept, ...rest] = projection.nodes.map((n) => n.id);
    const stored: Positions = { [kept as string]: { x: 7, y: 9 } };
    const elk = fakeElk();
    const result = await placeMissing(projection, stored, elk.run);
    expect(result.notice).toBeNull();
    expect(result.positions[kept as string]).toEqual({ x: 7, y: 9 });
    expect(Object.keys(result.positions).sort()).toEqual(
      projection.nodes.map((n) => n.id).sort(),
    );
    expect(Object.keys(result.added).sort()).toEqual([...rest].sort());
    // nothing to place: ELK isn't asked
    const again = await placeMissing(projection, result.positions, elk.run);
    expect(elk.graphs).toHaveLength(1);
    expect(again.added).toEqual({});
    expect(again.positions).toEqual(result.positions);
  });

  it("F-207: when ELK fails, columns are used, nothing is saved and a notice says so", async () => {
    const projection = await entryProjection();
    const result = await placeMissing(projection, {}, async () => {
      throw new Error("worker could not start");
    });
    expect(Object.keys(result.positions).sort()).toEqual(
      projection.nodes.map((n) => n.id).sort(),
    );
    expect(result.added).toEqual({});
    expect(result.notice).toBe(
      "Automatic layout isn't available (worker could not start). Nodes are placed in columns.",
    );
  });

  it("F-207 UX-26: with two or more selected nodes only the selection is laid out; otherwise all nodes, replacing the workflow's entries", async () => {
    const projection = await entryProjection();
    const ids = projection.nodes.map((n) => n.id);
    const current: Positions = Object.fromEntries(
      ids.map((id, i) => [id, { x: 10 * i, y: 500 + 10 * i }]),
    );
    const elk = fakeElk();
    const two = [ids[0] as string, ids[1] as string];
    const some = await autoLayout(projection, current, two, elk.run);
    expect(some.replace).toBe(false);
    expect(elk.graphs[0]?.children.map((c) => c.id)).toEqual(two);
    for (const id of ids.slice(2))
      expect(some.positions[id]).toEqual(current[id]);
    expect(some.positions[two[0] as string]).toEqual(current[two[0] as string]);
    const one = await autoLayout(
      projection,
      current,
      [two[0] as string],
      elk.run,
    );
    expect(one.replace).toBe(true);
    expect(elk.graphs[1]?.children).toHaveLength(ids.length);
    const none = await autoLayout(projection, current, [], elk.run);
    expect(none.replace).toBe(true);
    expect(Object.keys(none.positions).sort()).toEqual([...ids].sort());
  });
});
