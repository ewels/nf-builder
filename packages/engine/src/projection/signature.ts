// Ports of a callee (LA-20, LA-22), from its declaration. The dataflow kind of a process or agent result depends on the
// call's arguments, so `processSignature` gives element types (plain) and the projector applies the kind per call.
// Rules follow nf-lang v26.10.7 TypeCheckingVisitor `checkProcessCall` (L974-L1065) and `workflowEmitType`
// (L754-L786), Apache-2.0 (docs/licences.md).

import type {
  AgentDef,
  Callee,
  Expression,
  FlowType,
  ProcessInput,
  TypedProcess,
  WorkflowDef,
} from "@nf-builder/lang-core";
import { inlineType, isNullConstant } from "./inline";
import type { DataflowLibrary } from "./library";
import { asEmitType, flowFromDeclared, UNKNOWN, wrapFlow } from "./types";

export interface PortSpec {
  readonly id: string;
  readonly label: string;
  readonly type: FlowType | null;
}

export interface Signature {
  readonly kind: Callee["kind"];
  readonly typed: boolean | null;
  readonly inputs: readonly PortSpec[];
  readonly outputs: readonly PortSpec[];
}

const plainType = (name: string): FlowType =>
  wrapFlow("plain", { name, args: [], nullable: false });

function inputSpec(input: ProcessInput, index: number): PortSpec {
  switch (input.kind) {
    case "TypedName":
      return {
        id: input.name.name,
        label: input.name.name,
        type: flowFromDeclared(input.type),
      };
    case "RecordInput":
      return {
        id: `$${index + 1}`,
        label: `record(${input.fields.map((f) => f.name.name).join(", ")})`,
        type: plainType("Record"),
      };
    case "TupleInput":
      return {
        id: `$${index + 1}`,
        label: `tuple(${input.components.map((c) => c.name.name).join(", ")})`,
        type: plainType("Tuple"),
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
  const declared = new Map<string, FlowType | null>();
  for (const spec of inputs) declared.set(spec.id, spec.type);
  const outputItems = def.outputs?.items ?? [];
  const outputs = outputItems.map((item, index): PortSpec => {
    if (item.kind === "NamedOutput") {
      const type =
        flowFromDeclared(item.type) ??
        (item.value === null
          ? null
          : outputValueType(item.value, declared, library));
      return { id: item.name.name, label: item.name.name, type };
    }
    const id = outputItems.length === 1 ? "out" : `$${index + 1}`;
    return {
      id,
      label: id,
      type: outputValueType(item.expression, declared, library),
    };
  });
  return {
    kind: def.kind === "Agent" ? "agent" : "process",
    typed: true,
    inputs,
    outputs,
  };
}

/** A workflow's ports: one input per take, one output per emit, with a plain emit type exposed as `Value<T>`. */
export function workflowSignature(
  def: WorkflowDef,
  emitType: (name: string) => FlowType | null,
): Signature {
  const inputs = (def.takes?.items ?? []).map(
    (take): PortSpec => ({
      id: take.name.name,
      label: take.name.name,
      type: flowFromDeclared(take.type),
    }),
  );
  const emitItems = def.emits?.items ?? [];
  const outputs = emitItems.map((item, index): PortSpec => {
    let id: string;
    let declared: FlowType | null = null;
    if (item.kind === "NamedOutput") {
      id = item.name.name;
      declared = flowFromDeclared(item.type);
    } else if (item.expression.kind === "Variable") id = item.expression.name;
    else id = emitItems.length === 1 ? "out" : `$${index + 1}`;
    return {
      id,
      label: id,
      type: asEmitType(declared ?? emitType(id) ?? UNKNOWN),
    };
  });
  return { kind: "workflow", typed: def.typed, inputs, outputs };
}

/** For a callee with no usable declaration: `$1..$n` inputs and one output of unknown type. */
export function fallbackSignature(
  kind: Callee["kind"],
  argumentCount: number,
): Signature {
  return {
    kind,
    typed: null,
    inputs: Array.from({ length: argumentCount }, (_, i) => ({
      id: `$${i + 1}`,
      label: `$${i + 1}`,
      type: null,
    })),
    outputs: [{ id: "out", label: "out", type: null }],
  };
}

/**
 * nf-lang's `checkProcessCall` rule: the result is a channel if any argument is a channel, or is dynamic (not known)
 * and not a `null` constant; otherwise a value.
 */
export function callDataflow(
  args: readonly (FlowType | null)[],
): "channel" | "value" {
  return args.some(
    (a) =>
      a === null ||
      a.dataflow === "channel" ||
      (a.dataflow === null && !isNullConstant(a)),
  )
    ? "channel"
    : "value";
}
