import type {
  FlowType,
  GraphNode,
  Port,
  Projection,
  TypeExpr,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { tupleArity, tupleArityOf } from "../../src/lints/tuples.ts";
import { context } from "./context.ts";

const t = (name: string, ...args: TypeExpr[]): TypeExpr => ({
  name,
  args,
  nullable: false,
});
const flow = (
  dataflow: FlowType["dataflow"],
  element: TypeExpr | null,
): FlowType => ({ dataflow, element });
const rangeOf = (text: string, snippet: string) => {
  const start = text.indexOf(snippet);
  return {
    start,
    end: start + snippet.length,
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 2,
  };
};
const PROCESS =
  "process LEGACY {\n    input:\n    tuple val(meta), path(reads)\n\n    output:\n    stdout\n\n    script:\n    'x'\n}\n\n";

function projectionOf(
  text: string,
  snippet: string | null,
  options: { typed?: boolean | null; components?: number } = {},
): Projection {
  const input: Port = {
    id: "$1",
    label: "tuple(meta, reads)",
    type: flow("plain", t("Tuple")),
    argument: snippet === null ? null : rangeOf(text, snippet),
    argumentType: null,
    components: options.components ?? 2,
  };
  const call = {
    id: "call:LEGACY",
    kind: "call",
    label: "LEGACY",
    inputs: [input],
    outputs: [],
    range: rangeOf(text, "LEGACY(") ?? {},
    guards: [],
    callee: {
      name: "LEGACY",
      kind: "process",
      status: "modelled",
      typed: options.typed ?? false,
      path: "main.nf",
      module: null,
    },
  } as unknown as GraphNode;
  return {
    workflow: {
      path: "main.nf",
      name: null,
      modelled: true,
      typed: true,
      range: rangeOf(text, "workflow"),
    },
    nodes: [call],
    edges: [],
    statements: [],
  };
}

const typedText = (call: string) =>
  `nextflow.enable.types = true\n\n${PROCESS}workflow {\n    ${call}\n}\n`;
const run = (text: string, snippet: string, typed = false) =>
  tupleArity.check({
    ...context(text),
    projections: () => [projectionOf(text, snippet, { typed })],
  });

describe("F-302 LA-14 tuple arity", () => {
  it("F-302 LA-14: a one-component tuple(...) to a two-component legacy input is an error at the argument; the right count, a legacy caller and a typed callee are not", () => {
    const wrong = typedText("LEGACY(tuple('a'))");
    const found = run(wrong, "tuple('a')");
    expect(found).toHaveLength(1);
    expect(found[0]?.range).toMatchObject(rangeOf(wrong, "tuple('a')"));
    expect(found[0]?.message).toBe(
      "Tuple with 1 components is passed to the `tuple` input `tuple(meta, reads)` of `LEGACY`, which declares 2 -- pass one argument per declared component",
    );
    expect(
      run(typedText("LEGACY(tuple('a', 'b'))"), "tuple('a', 'b')"),
    ).toEqual([]);
    // a legacy caller (no types flag)
    const legacy = `${PROCESS}workflow {\n    LEGACY(tuple('a'))\n}\n`;
    expect(run(legacy, "tuple('a')")).toEqual([]);
    // a callee with no component count (a typed process)
    const typedCallee = tupleArity.check({
      ...context(wrong),
      projections: () => [
        projectionOf(wrong, "tuple('a')", {
          typed: true,
          components: undefined,
        }),
      ],
    });
    expect(typedCallee).toEqual([]);
  });

  it("F-302 LA-14: tupleArityOf compares a known Tuple<…> source and returns null when either count is unknown", () => {
    const input = (components?: number): Port => ({
      id: "$1",
      label: "tuple(a, b)",
      type: flow("plain", t("Tuple")),
      argument: null,
      argumentType: null,
      ...(components === undefined ? {} : { components }),
    });
    const source = (...args: TypeExpr[]) =>
      flow("channel", t("Tuple", ...args));
    expect(tupleArityOf(source(t("String")), input(2))).toEqual({
      expected: 2,
      actual: 1,
    });
    expect(tupleArityOf(source(t("String"), t("Path")), input(2))).toBeNull();
    expect(tupleArityOf(source(), input(2))).toBeNull();
    expect(tupleArityOf(source(t("String")), input())).toBeNull();
    expect(tupleArityOf(null, input(2))).toBeNull();
    expect(tupleArityOf(flow("channel", t("String")), input(2))).toBeNull();
    expect(tupleArityOf(flow("channel", null), input(2))).toBeNull();
  });
});
