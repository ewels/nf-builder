import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canvasView } from "../../src/canvas";
import { type LayoutNode, layeredLayout } from "../../src/canvas/layout";
import { readTree } from "../model/read-tree";
import { openFiles, projectorFor } from "../projection/open";
import { perturbWhitespace } from "../projection/whitespace";

const node = (
  id: string,
  kind: LayoutNode["kind"] = "call",
  height = 60,
): LayoutNode => ({ id, kind, width: 200, height });
const edges = (...pairs: [string, string][]) =>
  pairs.map(([source, target]) => ({ source, target }));

describe("F-205 interim layered layout", () => {
  const nodes = [
    node("t", "take"),
    node("a"),
    node("b"),
    node("c"),
    node("d"),
    node("e", "emit"),
    node("o", "output"),
  ];
  const links = edges(
    ["t", "a"],
    ["a", "b"],
    ["a", "c"],
    ["b", "d"],
    ["c", "d"],
    ["d", "e"],
  );

  it("F-205: every edge's target is in a later column than its source", () => {
    const pos = layeredLayout(nodes, links);
    for (const l of links)
      expect(pos.get(l.target)?.x ?? 0).toBeGreaterThan(
        pos.get(l.source)?.x ?? Number.POSITIVE_INFINITY,
      );
  });

  it("F-205 UX-51: take nodes are in the first column; emit and output nodes in the last", () => {
    const pos = layeredLayout(
      [node("a"), node("t", "take"), node("b"), node("o", "output")],
      edges(["a", "b"]),
    );
    const xs = [...pos.values()].map((p) => p.x);
    expect(pos.get("t")?.x).toBe(Math.min(...xs));
    expect(pos.get("o")?.x).toBe(Math.max(...xs));
    expect(pos.get("b")?.x).toBeGreaterThan(pos.get("a")?.x ?? 0);
  });

  it("F-205 UX-51: in a take to emit pass-through the emit is after the take", () => {
    const pos = layeredLayout(
      [node("t", "take"), node("e", "emit")],
      edges(["t", "e"]),
    );
    expect(pos.get("e")?.x ?? 0).toBeGreaterThan(pos.get("t")?.x ?? 0);
    const lone = layeredLayout(
      [node("t", "take"), node("o", "output")],
      edges(),
    );
    expect(lone.get("o")?.x ?? 0).toBeGreaterThan(lone.get("t")?.x ?? 0);
  });

  it("F-205: nodes in a column keep projection order and don't overlap", () => {
    const pos = layeredLayout(
      [node("s"), node("x", "call", 40), node("y", "call", 80), node("z")],
      edges(["s", "x"], ["s", "y"], ["s", "z"]),
    );
    const col = ["x", "y", "z"].map((id) => ({
      y: pos.get(id)?.y ?? 0,
      h: id === "x" ? 40 : id === "y" ? 80 : 60,
    }));
    for (let i = 1; i < col.length; i++) {
      const prev = col[i - 1];
      const cur = col[i];
      if (prev === undefined || cur === undefined) throw new Error("column");
      expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.h);
    }
  });

  it("F-205 AR-11: the layout is deterministic and terminates on a cycle", () => {
    const cyc = [node("a"), node("b"), node("c")];
    const loop = edges(["a", "b"], ["b", "c"], ["c", "a"]);
    const first = layeredLayout(cyc, loop);
    expect([...first]).toEqual([...layeredLayout(cyc, loop)]);
    expect(first.size).toBe(3);
    for (const p of first.values()) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("F-205 AR-11: the layout is unchanged by a whitespace-only re-parse", async () => {
    const dir = fileURLToPath(
      new URL("../../../../tools/oracle/cases/f205-canvas", import.meta.url),
    );
    const files = readTree(dir);
    const model = await openFiles(files);
    const layoutOf = async (m: typeof model) => {
      const p = (await projectorFor(m)).project("main.nf", null);
      if (p === null) throw new Error("no projection");
      return canvasView(p, { portLabels: true }).nodes.map((n) => [
        n.id,
        n.x,
        n.y,
      ]);
    };
    const base = await layoutOf(model);
    const again = await openFiles(
      files.map((f) => {
        const source = model.file(f.path)?.source;
        return source?.language === "nextflow"
          ? {
              path: f.path,
              text: perturbWhitespace(f.text, source.ast, 1, "all"),
            }
          : f;
      }),
    );
    expect(await layoutOf(again)).toEqual(base);
  });
});
