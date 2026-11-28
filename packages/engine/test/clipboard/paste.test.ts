import { describe, expect, it } from "vitest";
import { buildFragment } from "../../src/clipboard/fragment";
import { checkVersion, planPaste } from "../../src/clipboard/paste";
import { EditRefusal } from "../../src/edit/refusal";
import { node, stateFor } from "../edit/helpers";
import { blankFiles, caseFiles, entry } from "./fixtures";

const VERSION = "26.10";

/** The fragment of MAKE and SIZE copied from the f310-copy-source project. */
async function fragment() {
  const state = await stateFor(caseFiles("f310-copy-source"));
  return buildFragment(
    state,
    {
      path: "main.nf",
      workflow: null,
      nodes: [node(state, "make").id, node(state, "SIZE@1").id],
      positions: {},
    },
    VERSION,
  );
}

const refusal = (fn: () => unknown): EditRefusal => {
  try {
    fn();
  } catch (error) {
    if (error instanceof EditRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("F-310 planPaste", () => {
  it("F-310 UX-26: into the blank project every file is created, both includes added and no alias needed", async () => {
    const f = await fragment();
    const target = await stateFor(blankFiles());
    const plan = planPaste(target, f, entry, false);
    expect(plan.aliases).toEqual([]);
    expect(plan.creates.map((x) => x.path).sort()).toEqual([
      "modules/local/make/main.nf",
      "modules/local/size/main.nf",
    ]);
    expect(plan.nodes.map((n) => n.bound)).toEqual(["MAKE", "SIZE"]);
    expect(plan.includes).toEqual([
      {
        name: "MAKE",
        alias: null,
        source: "./modules/local/make/main.nf",
      },
      {
        name: "SIZE",
        alias: null,
        source: "./modules/local/size/main.nf",
      },
    ]);
  });

  it("F-310 ADR-0039: a process the workflow already calls needs an alias `X_2` (called), and reuses an include of the same definition", async () => {
    const f = await fragment();
    const target = await stateFor(caseFiles("f310-copy-source"));
    const plan = planPaste(target, f, entry, false);
    expect(plan.aliases).toEqual([
      { name: "MAKE", alias: "MAKE_2", reason: "called" },
      { name: "SIZE", alias: "SIZE_2", reason: "called" },
    ]);
    expect(plan.creates).toEqual([]);
    expect(plan.includes).toEqual([
      { name: "MAKE", alias: "MAKE_2", source: "./modules/local/make/main.nf" },
      { name: "SIZE", alias: "SIZE_2", source: "./modules/local/size/main.nf" },
    ]);
  });

  it("F-310: a process included but not yet called is reused with no include", async () => {
    const f = await fragment();
    const files = caseFiles("f310-copy-source");
    files["main.nf"] =
      "include { MAKE } from './modules/local/make/main.nf'\ninclude { SIZE } from './modules/local/size/main.nf'\n\nworkflow {\n}\n";
    const plan = planPaste(await stateFor(files), f, entry, false);
    expect(plan.aliases).toEqual([]);
    expect(plan.includes).toEqual([]);
  });

  it("F-310: a name bound to another definition needs an alias (taken)", async () => {
    const f = await fragment();
    const files = blankFiles();
    files["main.nf"] = "include { MAKE } from './other.nf'\n\nworkflow {\n}\n";
    files["other.nf"] = "process MAKE {\n    script:\n    'x'\n}\n";
    const plan = planPaste(await stateFor(files), f, entry, false);
    expect(plan.aliases).toEqual([
      { name: "MAKE", alias: "MAKE_2", reason: "taken" },
    ]);
  });

  it("F-310: identical files are reused, different ones refuse", async () => {
    const f = await fragment();
    const files = {
      ...blankFiles(),
      "modules/local/make/main.nf": caseFiles("f310-copy-source")[
        "modules/local/make/main.nf"
      ] as string,
    };
    const plan = planPaste(await stateFor(files), f, entry, false);
    expect(plan.creates.map((x) => x.path)).toEqual([
      "modules/local/size/main.nf",
    ]);
    const different = {
      ...blankFiles(),
      "modules/local/make/main.nf":
        "process OTHER {\n    script:\n    'x'\n}\n",
    };
    const other = await stateFor(different);
    const r = refusal(() => planPaste(other, f, entry, false));
    expect(r.message).toContain("modules/local/make/main.nf");
    expect(r.message).toContain("different content");
  });

  it("F-310 ADR-0039: an inline definition is pasted only into its own file of the same project", async () => {
    const state = await stateFor({
      "main.nf":
        "process P {\n    script:\n    'p'\n}\n\nworkflow {\n    P()\n}\n",
      "other.nf": "workflow W {\n}\n",
    });
    const f = buildFragment(
      state,
      {
        path: "main.nf",
        workflow: null,
        nodes: [node(state, "P@1").id],
        positions: {},
      },
      VERSION,
    );
    const into = (path: string, workflow: string | null, same: boolean) =>
      planPaste(state, f, { path, workflow }, same);
    expect(refusal(() => into("other.nf", "W", true)).message).toContain(
      "Move P to its own module to copy it",
    );
    expect(refusal(() => into("main.nf", null, false)).message).toContain(
      "Move P to its own module to copy it",
    );
  });

  it("F-310: a fragment of another language version refuses, naming both", async () => {
    const f = await fragment();
    expect(() => checkVersion(f, VERSION)).not.toThrow();
    const r = refusal(() => checkVersion(f, "27.04"));
    expect(r.message).toBe(
      "These nodes were copied from a Nextflow 26.10 project; this project uses 27.04.",
    );
  });
});
