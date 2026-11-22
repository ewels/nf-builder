import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canvasView } from "../../src/canvas";
import { readTree } from "../model/read-tree";
import { openFiles, projectorFor } from "../projection/open";

const path = (rel: string) =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));

const CANVAS = "tools/oracle/cases/f205-canvas";
const MAIN = "main.nf#";

async function projectionOf(
  files: { path: string; text: string }[],
  file: string,
  workflow: string | null,
) {
  const projector = await projectorFor(await openFiles(files));
  const projection = projector.project(file, workflow);
  if (projection === null) throw new Error(`no projection for ${file}`);
  return projection;
}

const canvas = () => readTree(path(CANVAS));

describe("F-205 step 1 step 2: the f205-canvas fixture", () => {
  it("F-205 step 1 step 2: canvasView gives every fixture node its appearance, badge and subtitle", async () => {
    const p = await projectionOf(canvas(), "main.nf", null);
    const view = canvasView(p, { portLabels: true });
    const node = (id: string) => {
      const v = view.nodes.find((n) => n.id === `${MAIN}/${id}`);
      if (v === undefined) throw new Error(id);
      return v;
    };
    const summary = (id: string) => {
      const v = node(id);
      return [v.appearance, v.shape, v.subtitle, v.badge];
    };
    expect(summary("greeted")).toEqual(["process", "card", "process", "typed"]);
    expect(summary("counted")).toEqual(["process", "card", "process", null]);
    expect(summary("wc")).toEqual([
      "module",
      "card",
      "nf-core/wordcount",
      null,
    ]);
    expect(summary("shouted")).toEqual([
      "workflow",
      "card",
      "workflow",
      "typed",
    ]);
    expect(summary("tail")).toEqual(["workflow", "card", "workflow", null]);
    expect(summary("upper")).toEqual(["workflow", "card", "pipeline", "typed"]);
    expect(summary("ch_pairs")[0]).toBe("chain");
    expect(summary("total")[0]).toBe("chain");
    expect(node("total").title).toBe("map → collect");
    expect(summary("ch_names")[0]).toBe("factory");
    expect(summary(":params")[0]).toBe("params");
    expect(summary(":output")[0]).toBe("output");
    expect(summary(":code@1")[0]).toBe("code");
    const sh = canvasView(
      await projectionOf(canvas(), "workflows.nf", "SHOUT"),
      {
        portLabels: true,
      },
    );
    expect(sh.nodes.map((n) => n.appearance)).toEqual([
      "take",
      "take",
      "chain",
      "emit",
    ]);
    expect(new Set(view.edges.map((e) => e.dataflow))).toEqual(
      new Set(["channel", "value", "plain", "unknown"]),
    );
  });

  it("F-205 UX-22: bad-declaration.nf's unparsed callee draws as unparsed", async () => {
    const text = readFileSync(
      path("tools/corpus/fixtures/bad-declaration.nf"),
      "utf8",
    );
    const p = await projectionOf([{ path: "main.nf", text }], "main.nf", null);
    const view = canvasView(p, { portLabels: true });
    expect(
      view.nodes.filter((n) => n.appearance === "unparsed").map((n) => n.title),
    ).toEqual(["SECOND"]);
  });

  it("F-205 UX-22: the entry workflow projects a node of every kind the canvas draws", async () => {
    const p = await projectionOf(canvas(), "main.nf", null);
    const kinds = new Set(p.nodes.map((n) => n.kind));
    for (const kind of [
      "call",
      "chain",
      "factory",
      "params",
      "output",
      "code",
    ] as const)
      expect(kinds, kind).toContain(kind);
    const sh = await projectionOf(canvas(), "workflows.nf", "SHOUT");
    expect(sh.nodes.map((n) => n.kind)).toEqual([
      "take",
      "take",
      "chain",
      "emit",
    ]);
  });

  it("F-205 UX-22 UX-23 ADR-0007: the callees cover typed and legacy processes, a registry module, and typed and legacy workflows", async () => {
    const p = await projectionOf(canvas(), "main.nf", null);
    const callee = (id: string) => {
      const node = p.nodes.find((n) => n.id === `${MAIN}/${id}`);
      if (node?.kind !== "call") throw new Error(`no call ${id}`);
      return node.callee;
    };
    expect(callee("greeted")).toMatchObject({
      kind: "process",
      status: "modelled",
      typed: true,
      module: null,
    });
    expect(callee("counted")).toMatchObject({
      kind: "process",
      typed: false,
      module: null,
    });
    expect(callee("wc")).toMatchObject({
      kind: "process",
      typed: false,
      module: "nf-core/wordcount",
    });
    expect(callee("shouted")).toMatchObject({ kind: "workflow", typed: true });
    expect(callee("tail")).toMatchObject({ kind: "workflow", typed: false });
    expect(callee("upper")).toMatchObject({
      kind: "pipeline",
      status: "modelled",
      typed: true,
    });
  });

  it("F-205 UX-24 LA-28: the edges include channel, value and plain dataflow", async () => {
    const p = await projectionOf(canvas(), "main.nf", null);
    const byFlow = (flow: string) =>
      p.edges.filter((e) => e.type.dataflow === flow).map((e) => e.variable);
    expect(byFlow("channel")).toContain("ch_names");
    expect(byFlow("value")).toEqual(["total"]);
    expect(byFlow("plain")).toContain("params.words");
  });

  it("F-205 UX-22: bad-declaration.nf calls an unparsed process, which the canvas draws as unparsed", async () => {
    const text = readFileSync(
      path("tools/corpus/fixtures/bad-declaration.nf"),
      "utf8",
    );
    const p = await projectionOf([{ path: "main.nf", text }], "main.nf", null);
    const statuses = p.nodes.flatMap((n) =>
      n.kind === "call" ? [[n.callee.name, n.callee.status]] : [],
    );
    expect(statuses).toEqual([
      ["FIRST", "modelled"],
      ["SECOND", "unparsed"],
    ]);
  });
});
