import type {
  FlowType,
  GraphEdge,
  GraphNode,
  Port,
  Projection,
  TypeExpr,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  assignable,
  connection,
  multipleChannels,
  nfFlowTypeName,
  nfTypeName,
  typeMismatch,
} from "../../src/lints/types.ts";
import { context } from "./context.ts";

const t = (name: string, ...args: TypeExpr[]): TypeExpr => ({
  name,
  args,
  nullable: false,
});
const WILD = t("?");
const flow = (
  dataflow: FlowType["dataflow"],
  element: TypeExpr | null,
): FlowType => ({ dataflow, element });
const RANGE = {
  start: 0,
  end: 1,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 2,
};
const isRecord = (name: string) => name === "Sample" || name === "Other";

const port = (
  id: string,
  type: FlowType | null,
  argument = false,
  argumentType: FlowType | null = null,
): Port => ({
  id,
  label: id,
  type,
  argument: argument ? { ...RANGE, start: 10, end: 12 } : null,
  argumentType,
});
const callNode = (
  kind: "process" | "workflow" | "agent",
  typed: boolean,
  inputs: Port[],
  name = "P",
): GraphNode =>
  ({
    id: `call:${name}`,
    kind: "call",
    label: name,
    inputs,
    outputs: [],
    range: RANGE,
    guards: [],
    callee: {
      name,
      kind,
      status: "modelled",
      typed,
      path: "main.nf",
      module: null,
    },
  }) as GraphNode;
const slot = (kind: "emit" | "output", name: string, input: Port): GraphNode =>
  ({
    id: `${kind}:${name}`,
    kind,
    label: name,
    name,
    inputs: [input],
    outputs: [],
    range: RANGE,
    guards: [],
  }) as unknown as GraphNode;
const edge = (to: GraphNode, portId: string, type: FlowType): GraphEdge => ({
  id: `e:${to.id}:${portId}`,
  from: { node: "src", port: "out" },
  to: { node: to.id, port: portId },
  type,
  variable: "v",
  direct: true,
});
const projection = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  name: string | null = null,
): Projection => ({
  workflow: {
    path: "main.nf",
    name,
    modelled: true,
    typed: true,
    range: RANGE,
  },
  nodes,
  edges,
  statements: [],
});
/** A typed script whose context carries the given projections. */
const typedContext = (text: string, projections: Projection[]) => ({
  ...context(`nextflow.enable.types = true\n\n${text}`),
  projections: () => projections,
});

describe("F-112 LA-29 LA-32 types", () => {
  it("F-112 LA-29 LA-32: compatibility follows nf-lang: process inputs compare elements; takes, emits and outputs compare kinds and elements", () => {
    const p = port("x", flow("plain", t("String")));
    const call = callNode("process", true, [p]);
    const check = (node: GraphNode, target: Port, source: FlowType | null) =>
      connection(source, node, target, isRecord);

    // a process input compares the element, whatever the dataflow kind of the argument
    expect(check(call, p, flow("channel", t("Integer")))).toBe("incompatible");
    expect(check(call, p, flow("value", t("String")))).toBe("compatible");
    expect(check(call, p, flow("plain", t("String")))).toBe("compatible");
    expect(check(call, p, flow("channel", t("String")))).toBe("compatible");
    const floatIn = port("f", flow("plain", t("Float")));
    expect(
      check(
        callNode("process", true, [floatIn]),
        floatIn,
        flow("channel", t("Integer")),
      ),
    ).toBe("compatible");
    const listIn = port("l", flow("plain", t("List", t("Path"))));
    expect(
      check(
        callNode("process", true, [listIn]),
        listIn,
        flow("plain", t("List", t("String"))),
      ),
    ).toBe("incompatible");
    const sampleIn = port("s", flow("plain", t("Sample")));
    const sampleCall = callNode("process", true, [sampleIn]);
    expect(check(sampleCall, sampleIn, flow("plain", t("String")))).toBe(
      "incompatible",
    );
    expect(check(sampleCall, sampleIn, flow("plain", t("Record")))).toBe(
      "unknown",
    );

    // a workflow take compares the kind first
    const take = port("c", flow("channel", t("String")));
    const wf = callNode("workflow", true, [take]);
    expect(check(wf, take, flow("value", t("String")))).toBe("incompatible");
    expect(check(wf, take, flow("plain", t("String")))).toBe("incompatible");
    expect(check(wf, take, flow("channel", t("Integer")))).toBe("incompatible");
    expect(check(wf, take, flow("channel", t("String")))).toBe("compatible");
    const plainTake = port("p", flow("plain", t("String")));
    const wf2 = callNode("workflow", true, [plainTake]);
    expect(check(wf2, plainTake, flow("channel", t("String")))).toBe(
      "incompatible",
    );
    expect(check(wf2, plainTake, flow("plain", t("Integer")))).toBe(
      "incompatible",
    );
    const valueTake = port("v", flow("value", t("Float")));
    const wf3 = callNode("workflow", true, [valueTake]);
    expect(check(wf3, valueTake, flow("value", t("Integer")))).toBe(
      "compatible",
    );
    const iterTake = port("i", flow("plain", t("Iterable", t("String"))));
    const wf4 = callNode("workflow", true, [iterTake]);
    expect(check(wf4, iterTake, flow("plain", t("List", t("String"))))).toBe(
      "compatible",
    );

    // an emit compares as a take does
    const emitIn = port("in", flow("channel", t("String")), true);
    const emit = slot("emit", "e", emitIn);
    expect(check(emit, emitIn, flow("channel", t("Integer")))).toBe(
      "incompatible",
    );
    expect(check(emit, emitIn, flow("value", t("String")))).toBe(
      "incompatible",
    );
    expect(check(emit, emitIn, flow("channel", t("String")))).toBe(
      "compatible",
    );

    // an output turns a plain target into Value<T> for a value source, then compares as a take
    const outIn = port("o", flow("plain", t("Path")), true);
    const output = slot("output", "o", outIn);
    expect(check(output, outIn, flow("value", t("Path")))).toBe("compatible");
    expect(check(output, outIn, flow("channel", t("Path")))).toBe(
      "incompatible",
    );
    expect(check(output, outIn, flow("plain", t("Integer")))).toBe(
      "incompatible",
    );
    expect(check(output, outIn, flow("plain", t("Path")))).toBe("compatible");
    const channelOut = port("c", flow("channel", t("String")), true);
    expect(
      check(
        slot("output", "c", channelOut),
        channelOut,
        flow("value", t("String")),
      ),
    ).toBe("incompatible");
  });

  it("F-112 LA-29: unknown or wildcard types are never incompatible", () => {
    const p = port("x", flow("plain", t("String")));
    const call = callNode("process", true, [p]);
    for (const source of [
      null,
      flow(null, null),
      flow("channel", null),
      flow("channel", WILD),
    ])
      expect(connection(source, call, p, isRecord)).not.toBe("incompatible");
    // no declared type, a legacy callee, an unmodelled callee and nodes that carry no declared type
    const untyped = port("x", null);
    expect(
      connection(
        flow("channel", t("Integer")),
        callNode("process", true, [untyped]),
        untyped,
      ),
    ).toBe("unknown");
    const legacy = callNode("process", false, [p]);
    expect(connection(flow("channel", t("Integer")), legacy, p)).toBe(
      "unknown",
    );
    const chain = { ...call, kind: "chain" } as unknown as GraphNode;
    expect(connection(flow("channel", t("Integer")), chain, p)).toBe("unknown");
    const wf = callNode("workflow", true, [
      port("c", flow("channel", t("String"))),
    ]);
    expect(connection(flow(null, t("Integer")), wf, wf.inputs[0] as Port)).toBe(
      "unknown",
    );

    expect(assignable(t("String"), WILD)).toBeNull();
    expect(assignable(t("Object"), t("Integer"))).toBe(true);
    expect(assignable(t("?"), t("Integer"))).toBe(true);
    expect(assignable(t("Foo"), t("String"))).toBeNull();
    expect(assignable(t("List"), t("List", t("String")))).toBe(true);
    expect(assignable(t("List", t("String")), t("List", WILD))).toBe(true);
    expect(
      assignable(
        t("Map", t("String"), WILD),
        t("Map", t("String"), t("Integer")),
      ),
    ).toBe(true);
    expect(assignable(t("List", t("Path")), t("List", t("Foo")))).toBeNull();
    expect(assignable(t("Float"), t("Integer"))).toBe(true);
    expect(assignable(t("Integer"), t("Float"))).toBe(false);
    expect(assignable(t("Path"), t("String"))).toBe(false);
    expect(assignable(t("Iterable", t("String")), t("Set", t("String")))).toBe(
      true,
    );
    expect(assignable(t("List"), t("Iterable"))).toBe(false);
    // records are structural, so only a record against a built-in type is certain
    expect(assignable(t("Record"), t("Sample"), isRecord)).toBe(true);
    expect(assignable(t("Sample"), t("Other"), isRecord)).toBeNull();
    expect(assignable(t("Sample"), t("Record"), isRecord)).toBeNull();
    expect(assignable(t("Sample"), t("Sample"), isRecord)).toBe(true);
    expect(assignable(t("Sample"), t("String"), isRecord)).toBe(false);
    expect(assignable(t("String"), t("Sample"), isRecord)).toBe(false);
    expect(assignable(t("Sample"), t("String"))).toBeNull();
  });

  it("F-112 LA-32: type names print as nextflow lint prints them", () => {
    expect(nfTypeName(t("List", t("String")))).toBe("List<String>");
    expect(nfTypeName(t("Map", t("String"), WILD))).toBe("Map<String, ?>");
    expect(nfTypeName({ ...t("Path"), nullable: true })).toBe("Path?");
    expect(nfTypeName(WILD)).toBe("?");
    expect(nfFlowTypeName(flow("channel", t("String")))).toBe(
      "Channel<String>",
    );
    expect(nfFlowTypeName(flow("value", t("List", t("Path"))))).toBe(
      "Value<List<Path>>",
    );
    expect(nfFlowTypeName(flow("plain", t("Integer")))).toBe("Integer");
    expect(nfFlowTypeName(flow("channel", null))).toBe("Channel<?>");
    expect(nfFlowTypeName(flow(null, null))).toBe("?");
  });
});

describe("F-112 LA-29 LA-32 rules", () => {
  it("F-112 LA-29: a call argument is checked against a typed process input, from its edge or its inline type, at the argument", () => {
    const nameIn = port("name", flow("plain", t("String")), true);
    const pathIn = port(
      "file",
      flow("plain", t("Path")),
      true,
      flow("plain", t("String")),
    );
    const okIn = port("ok", flow("plain", t("String")), true);
    const call = callNode("process", true, [nameIn, pathIn, okIn], "hello");
    const projections = [
      projection(
        [call],
        [
          edge(call, "name", flow("channel", t("Integer"))),
          edge(call, "ok", flow("channel", t("String"))),
        ],
      ),
    ];
    const found = typeMismatch.check(typedContext("workflow {}", projections));
    expect(found.map((f) => f.message)).toEqual([
      "Argument with type Integer is not compatible with process input of type String -- pass a String, or a channel or value of String",
      "Argument with type String is not compatible with process input of type Path -- pass a Path, or a channel or value of Path",
    ]);
    expect(found.every((f) => f.range.start === 10)).toBe(true);
  });

  it("F-112 LA-29: legacy scripts, legacy callees and calls with the wrong number of arguments are not type-checked", () => {
    const nameIn = port("name", flow("plain", t("String")), true);
    const call = callNode("process", true, [nameIn]);
    const bad = projection(
      [call],
      [edge(call, "name", flow("channel", t("Integer")))],
    );
    // a legacy script
    expect(
      typeMismatch.check({
        ...context("workflow {}"),
        projections: () => [bad],
      }),
    ).toEqual([]);
    // a legacy callee
    const legacy = callNode("process", false, [nameIn]);
    expect(
      typeMismatch.check(
        typedContext("workflow {}", [
          projection(
            [legacy],
            [edge(legacy, "name", flow("channel", t("Integer")))],
          ),
        ]),
      ),
    ).toEqual([]);
    // a call with the wrong number of arguments is skipped, the same call with the right number is checked
    const counted = (args: string) => {
      const base = typedContext(
        `process P {\n    input:\n    name: String\n    other: String\n\n    script:\n    'x'\n}\nworkflow {\n    P(${args})\n}`,
        [],
      );
      const start = base.file.text.indexOf("P(");
      const node = {
        ...callNode("process", true, [nameIn]),
        range: { ...RANGE, start, end: start + 4 },
      } as GraphNode;
      return {
        ...base,
        projections: () => [
          projection(
            [node],
            [edge(node, "name", flow("channel", t("Integer")))],
          ),
        ],
      };
    };
    expect(typeMismatch.check(counted("1"))).toEqual([]);
    expect(typeMismatch.check(counted("1, 2"))).toHaveLength(1);
    // an argument that no edge feeds and that has no inline type is unknown
    const loose = callNode("process", true, [
      port("name", flow("plain", t("String")), true),
    ]);
    expect(
      typeMismatch.check(
        typedContext("workflow {}", [projection([loose], [])]),
      ),
    ).toEqual([]);
    // an argument an inline expression reads is not the edge's type
    const inline = callNode("process", true, [
      port("name", flow("plain", t("String")), true),
    ]);
    const indirect = {
      ...edge(inline, "name", flow("channel", t("Integer"))),
      direct: false,
    };
    expect(
      typeMismatch.check(
        typedContext("workflow {}", [projection([inline], [indirect])]),
      ),
    ).toEqual([]);
  });

  it("F-112 LA-32: a workflow take, an emit and a workflow output are checked as nf-lang words them", () => {
    const takeIn = port("names", flow("channel", t("String")), true);
    const call = callNode("workflow", true, [takeIn], "shout");
    const emitIn = port("in", flow("channel", t("Integer")), true);
    const emit = slot("emit", "greeted", emitIn);
    const valueEmitIn = port("in", flow("channel", t("Integer")), true);
    const valueEmit = slot("emit", "counted", valueEmitIn);
    const outIn = port("summary", flow("plain", t("Integer")), true);
    const output = slot("output", "summary", outIn);
    const valueOutIn = port("report", flow("plain", t("Path")), true);
    const valueOutput = slot("output", "report", valueOutIn);
    const text = `workflow shout {
    take:
    names: Channel<String>

    main:
    greeted = names
    counted = names

    emit:
    greeted: Channel<Integer>
    counted: Channel<Integer> = counted
}

workflow {
    main:
    summary = file('x')
    report = channel.value(file('y'))

    publish:
    summary = summary
    report = report
}`;
    const found = typeMismatch.check(
      typedContext(text, [
        projection(
          [call],
          [edge(call, "names", flow("value", t("String")))],
          "caller",
        ),
        projection(
          [emit, valueEmit],
          [
            edge(emit, "in", flow("channel", t("String"))),
            edge(valueEmit, "in", flow("channel", t("String"))),
          ],
          "shout",
        ),
        projection(
          [output, valueOutput],
          [
            edge(output, "summary", flow("plain", t("Path"))),
            edge(valueOutput, "report", flow("value", t("Path"))),
          ],
        ),
      ]),
    );
    const full = typedContext(text, []);
    const source = (full.file as { text: string }).text;
    const where = (f: { range: { start: number } }) =>
      source.slice(f.range.start).split("\n")[0];
    expect(found.map((f) => f.message)).toEqual([
      "Argument with type Value<String> is not compatible with parameter of type Channel<String> -- pass a Channel<String>",
      "Workflow emit `greeted` with type Channel<Integer> cannot be assigned to value with type Channel<String> -- change the declared type, or emit a Channel<String>",
      "Assignment target with type Channel<Integer> cannot be assigned to value with type Channel<String> -- change the declared type, or emit a Channel<String>",
      "Workflow output `summary` with type Integer cannot be assigned to value with type Path -- change the output's type in the output block, or publish a value of type Integer",
    ]);
    // an emit or output is reported at its item, a call argument at the argument
    expect(found.slice(1).map(where)).toEqual([
      "    greeted: Channel<Integer>".trimStart(),
      "    counted: Channel<Integer> = counted".trimStart(),
      "    summary = summary".trimStart(),
    ]);
  });

  it("F-112 LA-32: more than one channel argument to a typed process or agent is flagged at the call, one channel is not", () => {
    const x = port("x", flow("plain", t("String")), true);
    const y = port("y", flow("plain", t("String")), true);
    const z = port(
      "z",
      flow("plain", t("String")),
      true,
      flow("value", t("String")),
    );
    const call = callNode("process", true, [x, y, z], "pair");
    const two = projection(
      [call],
      [
        edge(call, "x", flow("channel", t("String"))),
        edge(call, "y", flow("channel", t("String"))),
      ],
    );
    expect(
      multipleChannels
        .check(typedContext("workflow {}", [two]))
        .map((f) => f.message),
    ).toEqual([
      "Process `pair` was called with multiple channel arguments which can lead to non-deterministic behavior -- make sure that at most one argument is a channel and that all other arguments are dataflow values",
    ]);
    // a call through an alias names the declaration, as nextflow lint does (`include { pair as PAIR2 }`)
    const aliased = callNode("process", true, [x, y], "PAIR2");
    const base = typedContext(
      "process pair {\n    script:\n    'x'\n}\nworkflow {}",
      [
        projection(
          [aliased],
          [
            edge(aliased, "x", flow("channel", t("String"))),
            edge(aliased, "y", flow("channel", t("String"))),
          ],
        ),
      ],
    );
    expect(
      multipleChannels
        .check({
          ...base,
          lookup: (name) => base.lookup(name === "PAIR2" ? "pair" : name),
        })
        .map((f) => f.message.split(" was ")[0]),
    ).toEqual(["Process `pair`"]);
    const agent = callNode("agent", true, [x, y], "ask");
    expect(
      multipleChannels
        .check(
          typedContext("workflow {}", [
            projection(
              [agent],
              [
                edge(agent, "x", flow("channel", t("String"))),
                edge(agent, "y", flow("channel", t("String"))),
              ],
            ),
          ]),
        )
        .map((f) => f.message.split(" was ")[0]),
    ).toEqual(["Agent `ask`"]);
    const one = projection(
      [call],
      [
        edge(call, "x", flow("channel", t("String"))),
        edge(call, "y", flow("value", t("String"))),
      ],
    );
    expect(multipleChannels.check(typedContext("workflow {}", [one]))).toEqual(
      [],
    );
    // a legacy callee and a workflow call are not checked
    const legacy = callNode("process", false, [x, y]);
    const wf = callNode("workflow", true, [x, y]);
    for (const node of [legacy, wf])
      expect(
        multipleChannels.check(
          typedContext("workflow {}", [
            projection(
              [node],
              [
                edge(node, "x", flow("channel", t("String"))),
                edge(node, "y", flow("channel", t("String"))),
              ],
            ),
          ]),
        ),
      ).toEqual([]);
  });
});
