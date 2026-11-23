import type { Diagnostic, Range, WorkflowRef } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { nodeAtRange, problemTarget } from "../../src/problems";
import { openFiles, projectorFor } from "../projection/open";

const range = (start: number, end: number): Range => ({
  start,
  end,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
});
const at = (path: string, start: number, end: number): Diagnostic => ({
  path,
  range: range(start, end),
  severity: "warning",
  message: "m",
  code: "c",
});
const wf = (
  path: string,
  name: string | null,
  start: number,
  end: number,
  modelled = true,
): WorkflowRef => ({
  path,
  name,
  modelled,
  typed: null,
  range: range(start, end),
});

describe("F-309 problem targets", () => {
  it("F-309 UX-30: a diagnostic inside a workflow's range targets that workflow with inside true", () => {
    const workflows = [wf("a.nf", "A", 0, 50), wf("a.nf", "B", 60, 100, false)];
    expect(problemTarget(at("a.nf", 10, 20), workflows)).toEqual({
      kind: "workflow",
      path: "a.nf",
      workflow: "A",
      inside: true,
    });
    expect(problemTarget(at("a.nf", 70, 80), workflows)).toMatchObject({
      workflow: "B",
      inside: true,
    });
  });

  it("F-309 UX-27: a diagnostic outside every workflow of a file with workflows targets the file's entry workflow, else its first, with inside false", () => {
    const withEntry = [wf("a.nf", "A", 10, 20), wf("a.nf", null, 30, 40)];
    expect(problemTarget(at("a.nf", 0, 5), withEntry)).toEqual({
      kind: "workflow",
      path: "a.nf",
      workflow: null,
      inside: false,
    });
    const named = [wf("a.nf", "A", 10, 20), wf("a.nf", "B", 30, 40)];
    expect(problemTarget(at("a.nf", 0, 5), named)).toMatchObject({
      workflow: "A",
      inside: false,
    });
  });

  it("F-309 UX-20: a diagnostic in a file without workflows, or in a config file, targets a file tab", () => {
    const workflows = [wf("a.nf", null, 0, 50)];
    expect(problemTarget(at("m/main.nf", 1, 2), workflows)).toEqual({
      kind: "file",
      path: "m/main.nf",
    });
    expect(problemTarget(at("nextflow.config", 1, 2), [])).toEqual({
      kind: "file",
      path: "nextflow.config",
    });
  });

  it("F-309 UX-30: nodeAtRange gives the innermost node containing the range, never a params or output node spanning the workflow, and null for another path or no node", async () => {
    const text = [
      "workflow {",
      "    numbers = channel.of(1, 2)",
      "    numbers.view { v -> v }",
      "}",
      "",
    ].join("\n");
    const model = await openFiles([{ path: "main.nf", text }]);
    const projector = await projectorFor(model);
    const projection = projector.project("main.nf", null);
    if (projection === null) throw new Error("no projection");
    const start = text.indexOf("channel");
    const id = nodeAtRange(projection, "main.nf", {
      start,
      end: start + 7,
    });
    expect(id).toBe("main.nf#/numbers");
    const factory = projection.nodes.find((n) => n.id === id);
    expect(factory?.kind).toBe("factory");
    // the `workflow` keyword is in no node
    expect(nodeAtRange(projection, "main.nf", { start: 0, end: 8 })).toBeNull();
    expect(
      nodeAtRange(projection, "other.nf", { start, end: start + 7 }),
    ).toBeNull();
    // a params or output node with no block takes the workflow's range: never chosen
    const spanning = projection.nodes.filter(
      (n) =>
        (n.kind === "params" || n.kind === "output") &&
        n.range.start === projection.workflow.range.start &&
        n.range.end === projection.workflow.range.end,
    );
    for (const n of spanning)
      expect(nodeAtRange(projection, "main.nf", n.range)).not.toBe(n.id);
  });
});
