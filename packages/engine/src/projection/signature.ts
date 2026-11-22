// Ports of a callee (LA-20, LA-22), from its declaration. The dataflow kind of a process or agent result depends on the
// call's arguments, so `processSignature` gives element types (plain) and the projector applies the kind per call.
// Rules follow nf-lang v26.10.7 TypeCheckingVisitor `checkProcessCall` (L974-L1065) and `workflowEmitType`
// (L754-L786), Apache-2.0 (docs/licences.md).

import type {
  AgentDef,
  Argument,
  Dataflow,
  Expression,
  ExpressionStatement,
  FlowType,
  LegacyProcess,
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

// ---- legacy processes (LA-21) ----

/** A legacy process's ports; `repeats` marks an `each` input, which makes the result a channel (probed, 26.10.7). */
export interface LegacySignature extends Signature {
  readonly repeats: boolean;
}

interface Qualifier {
  readonly name: string;
  readonly args: readonly Argument[];
}

/** The qualifier of an item: a call such as `path x`, or a bare `stdin` or `stdout`. */
function qualifierOf(e: Expression): Qualifier | null {
  if (e.kind === "Variable") return { name: e.name, args: [] };
  if (
    e.kind === "MethodCall" &&
    e.receiver === null &&
    e.method.kind === "Identifier"
  )
    return { name: e.method.name, args: e.args };
  return null;
}

/** An identifier or the text of a string, for a label; null for any other expression. */
function textOf(e: Expression): string | null {
  switch (e.kind) {
    case "Variable":
      return e.name;
    case "String":
      return e.value;
    case "GString":
      return e.parts
        .map((p) => (p.kind === "GStringText" ? p.value : "\u0024{…}"))
        .join("");
    default:
      return null;
  }
}

const positional = (args: readonly Argument[]): Expression[] =>
  args.filter((a): a is Expression => a.kind !== "NamedArgument");

/** A tuple component such as `val(meta)` or `path('*.bam')`: its identifier or string text. */
function componentLabel(e: Expression): string {
  const q = qualifierOf(e);
  const [first] = q === null ? [] : positional(q.args);
  return (first === undefined ? null : textOf(first)) ?? "?";
}

/** The `emit:` name of an output, if it has one. */
function emitOf(args: readonly Argument[]): string | null {
  for (const a of args)
    if (
      a.kind === "NamedArgument" &&
      a.name.kind === "Identifier" &&
      a.name.name === "emit"
    )
      return textOf(a.value);
  return null;
}

const named = (name: string): { name: string; args: []; nullable: false } => ({
  name,
  args: [],
  nullable: false,
});

/** The element type of a port by qualifier. Inputs have no dataflow kind; outputs are plain until a call gives one. */
function elementType(
  qualifier: string,
  output: boolean,
  library: DataflowLibrary,
): FlowType | null {
  let element: ReturnType<DataflowLibrary["typedOutputType"]>;
  switch (qualifier) {
    case "path":
    case "file":
      element = named("Path");
      break;
    case "tuple":
      element = named("Tuple");
      break;
    case "stdin":
      element = named("String");
      break;
    case "env":
    case "eval":
    case "stdout":
      element = library.typedOutputType(qualifier);
      break;
    default:
      return null;
  }
  return element === null ? null : wrapFlow(output ? "plain" : null, element);
}

/**
 * One input port per `input:` line and one output port per `output:` line (LA-21), for legacy and typed callers
 * (LA-14). An input is named by its declared identifier, else `$<i>` from 1. An output is named by its `emit:`
 * value, else `out` when it is the only one, else `[<i>]` from 0, as `.out[i]` counts. `topic:` and `optional:`
 * outputs are ports too.
 */
export function legacyProcessSignature(
  def: LegacyProcess,
  library: DataflowLibrary,
): LegacySignature {
  let repeats = false;
  const inputs = (def.inputs?.items ?? []).map((item, index): PortSpec => {
    const fallback = `$${index + 1}`;
    const q = qualifierOf(item.expression);
    if (q === null) return spec(fallback, null);
    const type = elementType(q.name, false, library);
    if (q.name === "stdin") return { id: fallback, label: "stdin", type };
    if (q.name === "tuple") {
      const parts = positional(q.args).map(componentLabel);
      return { id: fallback, label: `tuple(${parts.join(", ")})`, type };
    }
    // `each path(x)` declares x through the inner qualifier
    if (q.name === "each") repeats = true;
    const [first] = positional(q.args);
    const inner =
      q.name === "each" && first?.kind === "MethodCall"
        ? qualifierOf(first)
        : null;
    const [declared] = inner === null ? q.args : inner.args;
    const [pattern] = inner === null ? [first] : positional(inner.args);
    const id = declared?.kind === "Variable" ? declared.name : null;
    return {
      id: id ?? fallback,
      label: id ?? (pattern === undefined ? null : textOf(pattern)) ?? fallback,
      type,
    };
  });
  const items = def.outputs?.items ?? [];
  const outputs = items.map((item, index): PortSpec => {
    const q = qualifierOf(item.expression);
    const id =
      (q === null ? null : emitOf(q.args)) ??
      (items.length === 1 ? "out" : `[${index}]`);
    return spec(id, q === null ? null : elementType(q.name, true, library));
  });
  return { inputs, outputs, repeats };
}

/**
 * The dataflow kind of a legacy call's results: a channel if any argument is a channel or not known (`null`), or an
 * input repeats (`each`); otherwise a value.
 */
export function legacyResultDataflow(
  signature: LegacySignature,
  args: readonly (Dataflow | null)[],
): "channel" | "value" {
  if (signature.repeats) return "channel";
  return args.some((a) => a === null || a === "channel") ? "channel" : "value";
}
