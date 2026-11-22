// Ports of a callee (LA-20, LA-22), from its declaration. The dataflow kind of a process or agent result depends on the
// call's arguments, so `processSignature` gives element types (plain) and the projector applies the kind per call.
// Rules follow nf-lang v26.10.7 TypeCheckingVisitor `checkProcessCall` (L974-L1065) and `workflowEmitType`
// (L754-L786), Apache-2.0 (docs/licences.md).

import type {
  AgentDef,
  Expression,
  ExpressionStatement,
  FlowType,
  NamedOutput,
  ProcessInput,
  ScriptAst,
  TypedProcess,
  WorkflowDef,
} from "@nf-builder/lang-core";
import { inlineType, plain } from "./inline";
import type { DataflowLibrary } from "./library";
import { asEmitType, flowFromDeclared, UNKNOWN, wrapFlow } from "./types";

export interface PortSpec {
  readonly id: string;
  readonly label: string;
  readonly type: FlowType | null;
}

export interface Signature {
  readonly inputs: readonly PortSpec[];
  readonly outputs: readonly PortSpec[];
}

/** A port labelled with its id. */
export function spec(id: string, type: FlowType | null): PortSpec {
  return { id, label: id, type };
}

function inputSpec(input: ProcessInput, index: number): PortSpec {
  switch (input.kind) {
    case "TypedName":
      return spec(input.name.name, flowFromDeclared(input.type));
    case "RecordInput":
      return {
        id: `$${index + 1}`,
        label: `record(${input.fields.map((f) => f.name.name).join(", ")})`,
        type: plain("Record"),
      };
    case "TupleInput":
      return {
        id: `$${index + 1}`,
        label: `tuple(${input.components.map((c) => c.name.name).join(", ")})`,
        type: plain("Tuple"),
      };
  }
}

/** The element type of a process output value: a typed-output function, an inline expression, or a declared input. */
function outputValueType(
  value: Expression,
  inputs: ReadonlyMap<string, FlowType | null>,
  library: DataflowLibrary,
): FlowType | null {
  if (value.kind === "Variable") return inputs.get(value.name) ?? null;
  if (
    value.kind === "MethodCall" &&
    value.receiver === null &&
    value.method.kind === "Identifier"
  ) {
    const typed = library.typedOutputType(value.method.name);
    if (typed !== null) return wrapFlow("plain", typed);
  }
  return inlineType(value, library);
}

export function processSignature(
  def: TypedProcess | AgentDef,
  library: DataflowLibrary,
): Signature {
  const inputs = (def.inputs?.items ?? []).map(inputSpec);
  const declared = new Map(inputs.map((s) => [s.id, s.type]));
  const outputItems = def.outputs?.items ?? [];
  const outputs = outputItems.map((item, index) => {
    if (item.kind === "NamedOutput")
      return spec(
        item.name.name,
        flowFromDeclared(item.type) ??
          (item.value === null
            ? null
            : outputValueType(item.value, declared, library)),
      );
    return spec(
      outputItems.length === 1 ? "out" : `$${index + 1}`,
      outputValueType(item.expression, declared, library),
    );
  });
  return { inputs, outputs };
}

/** The port name of an emit item: its name, the variable it names, `out` for a lone expression, else `$n`. */
export function emitName(
  item: NamedOutput | ExpressionStatement,
  index: number,
  count: number,
): string {
  if (item.kind === "NamedOutput") return item.name.name;
  if (item.expression.kind === "Variable") return item.expression.name;
  return count === 1 ? "out" : `$${index + 1}`;
}

/** A workflow's ports: one input per take, one output per emit, with a plain emit type exposed as `Value<T>`. */
export function workflowSignature(
  def: WorkflowDef,
  emitType: (name: string) => FlowType | null,
): Signature {
  const inputs = (def.takes?.items ?? []).map((take) =>
    spec(take.name.name, flowFromDeclared(take.type)),
  );
  const emitItems = def.emits?.items ?? [];
  const outputs = emitItems.map((item, index) => {
    const id = emitName(item, index, emitItems.length);
    const declared =
      item.kind === "NamedOutput" ? flowFromDeclared(item.type) : null;
    return spec(id, asEmitType(declared ?? emitType(id) ?? UNKNOWN));
  });
  return { inputs, outputs };
}

/**
 * An included pipeline (26.10): the params block's parameters are the inputs, the output block's declarations the
 * outputs, each wrapped as `workflowEmitType` does (`pipelineOutputType`, L890-L970).
 */
export function pipelineSignature(ast: ScriptAst): Signature {
  const params = ast.body.find((i) => i.kind === "ParamsBlock");
  const output = ast.body.find((i) => i.kind === "OutputBlock");
  return {
    inputs: (params?.params ?? []).map((p) =>
      spec(p.name.name, flowFromDeclared(p.type)),
    ),
    outputs: (output?.outputs ?? []).map((o) =>
      spec(o.name.name, asEmitType(flowFromDeclared(o.type) ?? UNKNOWN)),
    ),
  };
}

/** For a callee with no usable declaration: `$1..$n` inputs and one output of unknown type. */
export function fallbackSignature(argumentCount: number): Signature {
  return {
    inputs: Array.from({ length: argumentCount }, (_, i) =>
      spec(`$${i + 1}`, null),
    ),
    outputs: [spec("out", null)],
  };
}

/**
 * nf-lang's `checkProcessCall` rule: the result is a channel if any argument is a channel, or is dynamic (not known)
 * and not a `null` constant (which is plain here); otherwise a value.
 */
export function callDataflow(
  args: readonly (FlowType | null)[],
): "channel" | "value" {
  return args.some(
    (a) => a === null || a.dataflow === "channel" || a.dataflow === null,
  )
    ? "channel"
    : "value";
}
