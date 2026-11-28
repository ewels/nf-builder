import { join } from "node:path";
import type { WorkflowRef } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { calleeWorkflow, callPath } from "../src/navigation";
import { createProjector } from "../src/projection/project";
import { stateFor } from "./edit/helpers";
import { readTree } from "./model/read-tree";

const cases = new URL("../../../tools/oracle/cases/", import.meta.url).pathname;
const tree = (name: string) =>
  Object.fromEntries(readTree(join(cases, name)).map((f) => [f.path, f.text]));

async function open(files: Record<string, string>) {
  const state = await stateFor(files);
  const projector = createProjector(state.model, state.catalogue);
  const workflows = projector.workflows();
  const ref = (path: string, name: string | null) => {
    const found = workflows.find((w) => w.path === path && w.name === name);
    if (!found) throw new Error(`no workflow ${path} ${name}`);
    return found;
  };
  const callee = (path: string, name: string | null, label: string) => {
    const projection = projector.project(path, name);
    const node = projection?.nodes.find(
      (n) => n.kind === "call" && n.label === label,
    );
    if (!projection || !node) throw new Error(`no call ${label}`);
    return calleeWorkflow(state.model, projection, node.id, workflows);
  };
  return { state, projector, workflows, ref, callee };
}

const alignPath = "subworkflows/local/align/main.nf";

describe("F-307 calleeWorkflow", () => {
  it("F-307 UX-50: calleeWorkflow gives the definition of a workflow call, an aliased call and a pipeline call (its entry workflow)", async () => {
    const t = await open(tree("f307-workflow-tabs"));
    expect(t.callee("main.nf", null, "ALIGN")).toEqual(
      t.ref(alignPath, "ALIGN"),
    );
    // the alias MAP opens the definition ALIGN, not a workflow called MAP
    expect(t.callee("main.nf", null, "MAP")).toEqual(t.ref(alignPath, "ALIGN"));
    expect(t.callee(alignPath, "ALIGN", "SORT")).toEqual(
      t.ref("subworkflows/local/sort/main.nf", "SORT"),
    );
    const canvas = await open(tree("f205-canvas"));
    expect(canvas.callee("main.nf", null, "UPPER")).toEqual(
      canvas.ref("pipelines/upper.nf", null),
    );
    expect(canvas.callee("main.nf", null, "SHOUT")).toEqual(
      canvas.ref("workflows.nf", "SHOUT"),
    );
  });

  it("F-307 UX-50: calleeWorkflow refuses processes, unresolved and unparsed callees with their messages", async () => {
    const t = await open({
      "main.nf":
        "include { P } from './p.nf'\ninclude { GONE } from './gone.nf'\ninclude { BAD } from './bad.nf'\n\nworkflow {\n    P()\n    GONE()\n    BAD()\n}\n",
      "p.nf": "process P {\n    script:\n    'p'\n}\n",
      "bad.nf":
        "workflow BAD {\n    input\n    script:\n}\n\nworkflow OK {\n}\n",
    });
    const refusal = (label: string) => {
      const r = t.callee("main.nf", null, label);
      if (!("ok" in r)) throw new Error(`${label} opened`);
      expect(r.ok).toBe(false);
      return r.message;
    };
    expect(refusal("P")).toBe("P is a process.");
    expect(refusal("GONE")).toBe(
      "GONE isn't defined in this project, so it has no canvas.",
    );
    expect(refusal("BAD")).toBe(
      "BAD couldn't be parsed, so there is no canvas to show.",
    );
  });
});

describe("F-307 calleeWorkflow plugin includes", () => {
  it("F-307 UX-50: a name included from a plugin is not a call node, so calleeWorkflow is never asked about it", async () => {
    // A plugin contributes functions and operators, not workflows or processes, so `include { HELLO } from 'plugin/…'`
    // gives no `call` graph node (`callee` refusal for plugins can't arise); calleeWorkflow refuses any non-call node.
    const t = await open({
      "main.nf":
        "include { HELLO } from 'plugin/nf-hello'\n\nworkflow {\n    HELLO()\n}\n",
    });
    const projection = t.projector.project("main.nf", null);
    expect(projection?.nodes.some((n) => n.kind === "call")).toBe(false);
    const node = projection?.nodes[0];
    if (!projection || !node) throw new Error("no node");
    expect(
      calleeWorkflow(t.state.model, projection, node.id, t.workflows),
    ).toEqual({
      ok: false,
      message: "This node isn't a call, so it has no canvas.",
    });
  });
});

describe("F-307 callPath", () => {
  it("F-307 UX-50: callPath gives entry → ALIGN → SORT, null when unreachable, and terminates on recursion", async () => {
    const t = await open(tree("f307-workflow-tabs"));
    const entry = t.ref("main.nf", null);
    const align = t.ref(alignPath, "ALIGN");
    const sort = t.ref("subworkflows/local/sort/main.nf", "SORT");
    const project = (r: WorkflowRef) => t.projector.project(r.path, r.name);
    const path = (from: WorkflowRef, to: WorkflowRef) =>
      callPath(t.state.model, project, t.workflows, from, to);
    // ancestors only: the target itself is not in the path
    expect(path(entry, sort)).toEqual([entry, align]);
    expect(path(entry, align)).toEqual([entry]);
    expect(path(entry, entry)).toEqual([]);
    expect(path(sort, entry)).toBeNull();

    const loop = await open({
      "main.nf": "include { A } from './a.nf'\n\nworkflow {\n    A()\n}\n",
      "a.nf":
        "include { B } from './b.nf'\n\nworkflow A {\n    main:\n    B()\n}\n",
      "b.nf":
        "include { A } from './a.nf'\n\nworkflow B {\n    main:\n    A()\n}\n",
      "c.nf": "workflow C {\n    main:\n    channel.of(1).view()\n}\n",
    });
    const lp = (r: WorkflowRef) => loop.projector.project(r.path, r.name);
    expect(
      callPath(
        loop.state.model,
        lp,
        loop.workflows,
        loop.ref("main.nf", null),
        loop.ref("c.nf", "C"),
      ),
    ).toBeNull();
    expect(
      callPath(
        loop.state.model,
        lp,
        loop.workflows,
        loop.ref("main.nf", null),
        loop.ref("b.nf", "B"),
      )?.map((r) => r.name),
    ).toEqual([null, "A"]);
  });
});
