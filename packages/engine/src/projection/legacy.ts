// Syntax helpers for legacy dataflow (AR-14, F-107): `set` and `tap`, `.out`, and pipes. Pure: what the projector
// does with them is in project.ts. `set` and `tap` count as assignments only when the closure is exactly one bare
// variable, as in nf-lang v26.10.7 VariableScopeVisitor L773-L786; `.out` resolves only on a process or workflow
// name, as in ASTUtils L226-L229 (Apache-2.0, docs/licences.md).

import type {
  BinaryExpr,
  Expression,
  FlowType,
  IndexExpr,
  LegacyOperator,
  MethodCall,
  Range,
  TypeExpr,
  Variable,
} from "@nf-builder/lang-core";
import { wrapFlow } from "./types";

export const unwrap = (e: Expression): Expression =>
  e.kind === "Parenthesized" ? unwrap(e.expression) : e;

/**
 * `set` and `tap` as nf-lang v26.10.7 reads them (VariableScopeVisitor L773-L786, ASTUtils `asDslBlock`, checked with
 * `nextflow lint`): the call's only argument is a closure, in parentheses or trailing, whose body is exactly one bare
 * variable; the closure's parameters are not looked at, so `set { v -> v }` declares `v` too. A pipe's `set { v }` has
 * no receiver, so callers that need one check it. The one shared reading of this shape (F-107 and F-108).
 */
export function setTarget(call: MethodCall): {
  readonly form: "set" | "tap";
  readonly variable: Variable;
} | null {
  if (call.method.kind !== "Identifier") return null;
  const form = call.method.name;
  if (form !== "set" && form !== "tap") return null;
  const all = [...call.args, ...call.closures];
  const [closure] = all;
  if (all.length !== 1 || closure?.kind !== "Closure") return null;
  const [only] = closure.body;
  if (closure.body.length !== 1 || only?.kind !== "ExpressionStatement")
    return null;
  return only.expression.kind === "Variable"
    ? { form, variable: only.expression }
    : null;
}

/** The `n` of `x[n]` for an integer literal index; null for anything else. */
export function integerIndex(e: IndexExpr): number | null {
  const [index] = e.indices;
  return e.indices.length === 1 &&
    index?.kind === "Number" &&
    index.integer &&
    /^(0|[1-9][0-9]*)$/.test(index.text)
    ? Number(index.text)
    : null;
}

/**
 * `X.out`, `X.out.name` or `X.out[n]`: the callee name and what is selected from its results (a name, an index, or
 * null for all of them).
 */
export function outPath(expression: Expression): {
  readonly callee: string;
  readonly selector: string | number | null;
} | null {
  const e = unwrap(expression);
  const whole = (at: Expression): string | null => {
    const x = unwrap(at);
    return x.kind === "Property" &&
      x.property.kind === "Identifier" &&
      x.property.name === "out" &&
      x.object.kind === "Variable"
      ? x.object.name
      : null;
  };
  if (e.kind === "Index") {
    const callee = whole(e.object);
    const index = integerIndex(e);
    return callee === null || index === null
      ? null
      : { callee, selector: index };
  }
  if (e.kind !== "Property") return null;
  const direct = whole(e);
  if (direct !== null) return { callee: direct, selector: null };
  if (e.property.kind !== "Identifier") return null;
  const callee = whole(e.object);
  return callee === null ? null : { callee, selector: e.property.name };
}

export type PipeStep =
  /** A process, workflow or operator: a bare name, or a call with no receiver such as `map { ... }`. */
  | {
      readonly kind: "step";
      readonly expression: Expression;
      readonly name: string;
      readonly range: Range;
    }
  /** `(A & B)`: each name receives the same input. */
  | {
      readonly kind: "fork";
      readonly names: readonly string[];
      readonly range: Range;
    };

function forkNames(e: Expression): string[] | null {
  const x = unwrap(e);
  if (x.kind === "Variable") return [x.name];
  if (x.kind !== "Binary" || x.operator !== "&") return null;
  const left = forkNames(x.left);
  const right = forkNames(x.right);
  return left === null || right === null ? null : [...left, ...right];
}

/** `a | b | c` as its source and steps in order; null when a step is neither a name, a receiver-less call nor a fork. */
export function pipeSteps(
  e: BinaryExpr,
): { readonly source: Expression; readonly steps: readonly PipeStep[] } | null {
  if (e.operator !== "|") return null;
  const steps: PipeStep[] = [];
  let at: Expression = e;
  while (at.kind === "Binary" && at.operator === "|") {
    const step: Expression = at.right;
    const inner = unwrap(step);
    if (step.kind === "Parenthesized" && inner.kind === "Binary") {
      const names = forkNames(inner);
      if (names === null || names.length < 2) return null;
      steps.unshift({ kind: "fork", names, range: step.range });
    } else if (inner.kind === "Variable") {
      steps.unshift({
        kind: "step",
        expression: inner,
        name: inner.name,
        range: inner.range,
      });
    } else if (
      inner.kind === "MethodCall" &&
      inner.receiver === null &&
      inner.method.kind === "Identifier"
    ) {
      steps.unshift({
        kind: "step",
        expression: inner,
        name: inner.method.name,
        range: inner.range,
      });
    } else return null;
    at = at.left;
  }
  return { source: at, steps };
}

/** Operators whose result keeps the receiver's element type. */
const KEEPS_ELEMENT: ReadonlySet<string> = new Set([
  "first",
  "last",
  "concat",
  "distinct",
]);

/** The result type of a legacy-only operator: its documented kind, with the element when it is unchanged. */
export function legacyOperatorType(
  name: string,
  result: Exclude<LegacyOperator["result"], "assign">,
  receiver: FlowType,
): FlowType {
  const element: TypeExpr | null = KEEPS_ELEMENT.has(name)
    ? receiver.element
    : null;
  return wrapFlow(result, element);
}
