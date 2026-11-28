import { describe, expect, it } from "vitest";
import { buildFragment, summarise } from "../../src/clipboard/fragment";
import { EditRefusal } from "../../src/edit/refusal";
import { node, projection, stateFor } from "../edit/helpers";
import { caseFiles } from "./fixtures";

const request = (
  nodes: string[],
  positions: Record<string, { x: number; y: number }> = {},
) => ({ path: "main.nf", workflow: null, nodes, positions });
const VERSION = "26.10";

const refusal = (fn: () => unknown): EditRefusal => {
  try {
    fn();
  } catch (error) {
    if (error instanceof EditRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("F-310 buildFragment", () => {
  it("F-310 UX-26: copying two connected calls carries both definition files, the edge by port id, and offsets", async () => {
    const state = await stateFor(caseFiles("f310-copy-source"));
    const make = node(state, "make").id;
    const size = node(state, "SIZE@1").id;
    const f = buildFragment(
      state,
      request([size, make], {
        [make]: { x: 100, y: 50 },
        [size]: { x: 400, y: 80 },
      }),
      VERSION,
    );
    expect(f.languageVersion).toBe(VERSION);
    expect(f.nodes.map((n) => [n.callee, n.kind, n.definition])).toEqual([
      ["MAKE", "process", "modules/local/make/main.nf"],
      ["SIZE", "process", "modules/local/size/main.nf"],
    ]);
    expect(f.nodes.map((n) => n.offset)).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 30 },
    ]);
    expect(f.edges).toHaveLength(1);
    expect(f.edges[0]?.from.node).toBe(make);
    expect(f.edges[0]?.to).toEqual({ node: size, port: "data" });
    expect(f.files.map((x) => x.path).sort()).toEqual([
      "modules/local/make/main.nf",
      "modules/local/size/main.nf",
    ]);
    expect(f.files.find((x) => x.path.includes("make"))?.text).toBe(
      caseFiles("f310-copy-source")["modules/local/make/main.nf"],
    );
    expect(summarise(f)).toEqual({
      nodes: 2,
      connections: 1,
      labels: ["MAKE", "SIZE"],
      languageVersion: VERSION,
    });
    expect(structuredClone(f)).toEqual(f);
  });

  it("F-310: edges to unselected nodes are dropped", async () => {
    const state = await stateFor(caseFiles("f310-copy-source"));
    const f = buildFragment(
      state,
      request([node(state, "SIZE@1").id]),
      VERSION,
    );
    expect(f.edges).toEqual([]);
    expect(f.nodes).toHaveLength(1);
    expect(f.files.map((x) => x.path)).toEqual(["modules/local/size/main.nf"]);
  });

  it("F-310: transitive local includes and the module directory come along", async () => {
    const state = await stateFor({
      "main.nf":
        "include { P } from './modules/local/p/main.nf'\n\nworkflow {\n    P()\n}\n",
      "modules/local/p/main.nf":
        "include { helper } from '../../../lib.nf'\n\nprocess P {\n    script:\n    'p'\n}\n",
      "modules/local/p/meta.yml": "name: p\n",
      "modules/local/p/templates/t.sh": "echo\n",
      "modules/local/other/main.nf": "process O {\n    script:\n    'o'\n}\n",
      "lib.nf":
        "include { more } from './more.nf'\n\nprocess helper {\n    script:\n    'h'\n}\n",
      "more.nf": "process more {\n    script:\n    'm'\n}\n",
    });
    const f = buildFragment(state, request([node(state, "P@1").id]), VERSION);
    expect(f.files.map((x) => x.path).sort()).toEqual([
      "lib.nf",
      "modules/local/p/main.nf",
      "modules/local/p/meta.yml",
      "modules/local/p/templates/t.sh",
      "more.nf",
    ]);
  });

  it("F-310: a chain or factory node refuses, naming it", async () => {
    const state = await stateFor({
      ...caseFiles("f310-copy-source"),
      "main.nf":
        "include { MAKE } from './modules/local/make/main.nf'\n\nworkflow {\n    ch = channel.of(1)\n    MAKE()\n}\n",
    });
    const factory = projection(state).nodes.find((n) => n.kind === "factory");
    const r = refusal(() =>
      buildFragment(
        state,
        request([node(state, "MAKE@1").id, factory?.id ?? ""]),
        VERSION,
      ),
    );
    expect(r.code).toBe("invalid");
    expect(r.message).toContain("can't be copied yet");
    expect(r.message).toContain(factory?.label as string);
    expect(
      refusal(() => buildFragment(state, request([]), VERSION)).message,
    ).toContain("Select");
  });

  it("F-310: a callee that isn't a project file (plugin, unresolved) refuses", async () => {
    const state = await stateFor({
      "main.nf":
        "include { MISSING } from './nope.nf'\n\nworkflow {\n    MISSING()\n}\n",
    });
    const n = projection(state).nodes.find((x) => x.kind === "call");
    expect(
      refusal(() => buildFragment(state, request([n?.id ?? ""]), VERSION))
        .message,
    ).toContain("MISSING");
  });

  it("F-310 IO-12: a file over 1 MB refuses", async () => {
    const files = caseFiles("f310-copy-source");
    files["modules/local/make/main.nf"] =
      `${files["modules/local/make/main.nf"]}\n// ${"x".repeat(1_000_001)}\n`;
    const state = await stateFor(files);
    const r = refusal(() =>
      buildFragment(state, request([node(state, "make").id]), VERSION),
    );
    expect(r.message).toContain("1 MB");
    expect(r.message).toContain("modules/local/make/main.nf");
  });

  it("F-310 ADR-0039: a definition in the workflow's own file is marked inline", async () => {
    const state = await stateFor({
      "main.nf":
        "process P {\n    script:\n    'p'\n}\n\nworkflow {\n    P()\n}\n",
    });
    const f = buildFragment(state, request([node(state, "P@1").id]), VERSION);
    expect(f.nodes[0]?.inline).toBe(true);
    expect(f.files).toEqual([]);
  });
});
