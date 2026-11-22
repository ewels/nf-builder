import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
