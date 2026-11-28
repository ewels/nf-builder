import type {
  Diagnostic,
  GraphEdge,
  GraphNode,
  Port,
  Projection,
  Range,
  WorkflowRef,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { edgeMismatches } from "../../src/canvas/mismatch";

const at = (start: number, end: number): Range => ({
  start,
  end,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
});
const ref: WorkflowRef = {
  path: "main.nf",
  name: null,
  modelled: true,
  typed: true,
  range: at(0, 100),
};
const port = (id: string, argument: Range | null = null): Port => ({
  id,
  label: id,
  type: null,
  argument,
  argumentType: null,
});
const node = (id: string, inputs: Port[], outputs: Port[]): GraphNode =>
  ({
    id,
    label: id,
    inputs,
    outputs,
    range: at(0, 0),
    guards: [],
    kind: "factory",
    namespace: "channel",
    factory: "of",
  }) as GraphNode;
const edge = (from: string, to: string, port: string): GraphEdge => ({
  id: `${from} -> ${to}[${port}]`,
  from: { node: from, port: "out" },
  to: { node: to, port },
  type: { dataflow: "channel", element: null },
  variable: null,
  direct: true,
});
const diag = (
  code: string,
  range: Range,
  over: Partial<Diagnostic> = {},
): Diagnostic => ({
  path: "main.nf",
  range,
  severity: "error",
  message: `${code} message`,
  code,
  ...over,
});
const projection = (
  inputs: Port[],
  edges: GraphEdge[],
  path = "main.nf",
): Projection => ({
  workflow: { ...ref, path },
  nodes: [node("a", [], [port("out")]), node("b", inputs, [])],
  edges,
  statements: [],
});

describe("F-302 edgeMismatches", () => {
  it("F-302 UX-24 LA-32: a type-mismatch at a call argument marks every edge into that port; other codes, other files and other ports mark nothing", () => {
    const p = projection(
      [port("x", at(10, 20)), port("y", at(30, 40))],
      [edge("a", "b", "x"), edge("a", "b", "x"), edge("a", "b", "y")].map(
        (e, i) => ({ ...e, id: `e${i}` }),
      ),
    );
    const marks = edgeMismatches(p, [
      diag("type-mismatch", at(10, 20)),
      diag("call-arity", at(30, 40)),
      diag("type-mismatch", at(30, 40), { path: "other.nf" }),
    ]);
    expect([...marks.keys()]).toEqual(["e0", "e1"]);
    expect(marks.get("e0")).toBe("type-mismatch message");
  });

  it("F-302 UX-24: emit and output mismatches mark the edge whose argument the item contains", () => {
    const p = projection([port("x", at(12, 18))], [edge("a", "b", "x")]);
    const marks = edgeMismatches(p, [diag("type-mismatch", at(5, 25))]);
    expect(marks.size).toBe(1);
    expect(edgeMismatches(p, [diag("type-mismatch", at(13, 25))]).size).toBe(0);
  });

  it("F-302 LA-14: a tuple-arity diagnostic marks its edge", () => {
    const p = projection([port("x", at(10, 20))], [edge("a", "b", "x")]);
    const marks = edgeMismatches(p, [diag("tuple-arity", at(10, 20))]);
    expect(marks.get(p.edges[0]?.id ?? "")).toBe("tuple-arity message");
  });
});
