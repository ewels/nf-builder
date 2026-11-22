import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nodeView } from "../../src/details/node-view";
import { workflowSummary } from "../../src/details/summary";
import { readTree } from "../model/read-tree";
import { openFiles, projectorFor } from "../projection/open";

const path = (rel: string) =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));

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

const canvas = () => readTree(path("tools/oracle/cases/f205-canvas"));
const details = () => readTree(path("tools/oracle/cases/f206-details"));

describe("F-206 step 1: the node views of the fixtures", () => {
  it("F-206 step 1: every node of the f205-canvas and bad-declaration projections has a name, kind label, file and one row per port", async () => {
    const bad = readFileSync(
      path("tools/corpus/fixtures/bad-declaration.nf"),
      "utf8",
    );
    const projections = [
      await projectionOf(canvas(), "main.nf", null),
      await projectionOf(canvas(), "workflows.nf", "SHOUT"),
      await projectionOf(canvas(), "legacy.nf", "LEGACY_TAIL"),
      await projectionOf([{ path: "main.nf", text: bad }], "main.nf", null),
    ];
    let seen = 0;
    for (const p of projections)
      for (const node of p.nodes) {
        const v = nodeView(p, node.id);
        expect(v, node.id).not.toBeNull();
        if (v === null) continue;
        seen++;
        expect(v.name, node.id).not.toBe("");
        expect(v.kindLabel, node.id).not.toBe("");
        expect(v.path === null, node.id).toBe(
          node.kind === "call" && node.callee.path === null,
        );
        expect(v.inputs.map((i) => i.id)).toEqual(node.inputs.map((i) => i.id));
        expect(v.outputs.map((o) => o.id)).toEqual(
          node.outputs.map((o) => o.id),
        );
        expect(structuredClone(v)).toEqual(v);
      }
    expect(seen).toBeGreaterThan(15);
    const unparsed = projections[3]?.nodes.find(
      (n) => n.kind === "call" && n.callee.name === "SECOND",
    );
    expect(
      unparsed && nodeView(projections[3] as never, unparsed.id)?.kindLabel,
    ).toMatch(/\(could not be parsed\)$/);
  });

  it("F-206 step 1: the f205-canvas entry views name each callee kind and connect it by variable", async () => {
    const p = await projectionOf(canvas(), "main.nf", null);
    const label = (id: string) => nodeView(p, `main.nf#/${id}`)?.kindLabel;
    expect(label("greeted")).toBe("Typed process");
    expect(label("counted")).toBe("Legacy process");
    expect(label("wc")).toBe(
      "Legacy process · registry module nf-core/wordcount",
    );
    expect(label("shouted")).toBe("Typed workflow");
    expect(label("tail")).toBe("Legacy workflow");
    expect(label("upper")).toBe("Pipeline");
    const greeted = nodeView(p, "main.nf#/greeted");
    expect(greeted?.inputs[0]?.connections[0]?.text).toBe("from ch_names");
    expect(greeted?.inputs[1]?.connections[0]?.text).toBe(
      "from params.greeting",
    );
    const s = workflowSummary(p);
    expect(s.modules).toEqual([
      { module: "nf-core/wordcount", calls: ["WORDCOUNT"] },
    ]);
    expect(s.params.map((x) => x.name)).toEqual(["greeting", "words"]);
  });
});

describe("F-206 UX-30 LA-20: the f206-details fixture projection", () => {
  it("F-206 UX-30: f206-details projects TRIM as a typed process and LEGACY_VERSIONS as a legacy one, with a params default, a chain and an output", async () => {
    const p = await projectionOf(details(), "main.nf", null);
    const kinds = p.nodes.map((n) => n.kind);
    for (const kind of [
      "params",
      "factory",
      "call",
      "chain",
      "output",
    ] as const)
      expect(kinds, kind).toContain(kind);
    const trim = nodeView(p, "main.nf#/trimmed");
    expect(trim).toMatchObject({
      name: "TRIM",
      kindLabel: "Typed process",
      path: "modules/local/trim/main.nf",
    });
    expect(trim?.inputs.map((i) => i.connections[0]?.text)).toEqual([
      "from ch_names",
      "from params.greeting",
    ]);
    const legacy = p.nodes.find(
      (n) => n.kind === "call" && n.callee.name === "LEGACY_VERSIONS",
    );
    if (legacy === undefined) throw new Error("no LEGACY_VERSIONS call");
    expect(nodeView(p, legacy.id)).toMatchObject({
      kindLabel: "Legacy process",
      path: "modules/local/legacy_versions/main.nf",
    });
    const chain = p.nodes.find((n) => n.kind === "chain");
    expect(chain && nodeView(p, chain.id)?.name).toBe("map → collect");
  });
});
