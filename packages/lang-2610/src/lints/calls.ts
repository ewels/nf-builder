// Call checks (LA-33, F-112): an argument count that doesn't match the callee (nf-lang `TypeCheckingVisitor` L648 in
// typed scripts, `CallArityVisitor` L73 in legacy ones) and outputs that nothing uses (ours).
import type {
  AgentDef,
  Argument,
  AstNode,
  BinaryExpr,
  Expression,
  IfStatement,
  IncludableDeclaration,
  LintContext,
  LintFinding,
  LintRule,
  MethodCall,
  ProcessDef,
  WorkflowDef,
} from "@nf-builder/lang-core";
import { childNodes, walk } from "@nf-builder/lang-core";
import {
  argumentCount,
  configPublishes,
  directiveCalls,
  methodName,
  readsIn,
  scriptOf,
  workflowCalls,
} from "./scan.ts";

const positional = (args: readonly Argument[]): Expression[] =>
  args.filter((a): a is Expression => a.kind !== "NamedArgument");

/** `val x`, `path 'f'`, `tuple val(a), path(b)`: the identifier it declares, else the qualifier. */
function legacyLabel(e: Expression): string {
  if (e.kind === "Variable") return e.name;
  if (e.kind !== "MethodCall" || e.receiver !== null) return "input";
  const qualifier = methodName(e);
  const args = positional(e.args);
  if (qualifier === "tuple")
    return `tuple(${args.map(legacyLabel).join(", ")})`;
  const [first] = args;
  if (first?.kind === "Variable") return first.name;
  if (qualifier === "each" && first?.kind === "MethodCall")
    return legacyLabel(first);
  return qualifier;
}

/** The names of a callee's inputs, in order: takes, typed inputs or legacy inputs; null for anything that can't be called. */
export function declaredInputs(
  declaration: IncludableDeclaration,
): readonly string[] | null {
  switch (declaration.kind) {
    case "Workflow":
      return declaration.name === null
        ? null
        : (declaration.takes?.items ?? []).map((t) => t.name.name);
    case "Agent":
      return typedInputs(declaration);
    case "Process":
      return declaration.typed
        ? typedInputs(declaration)
        : (declaration.inputs?.items ?? []).map((i) =>
            legacyLabel(i.expression),
          );
    default:
      return null;
  }
}

function typedInputs(def: AgentDef | Extract<ProcessDef, { typed: true }>) {
  return (def.inputs?.items ?? []).map((input) =>
    input.kind === "TypedName"
      ? input.name.name
      : input.kind === "RecordInput"
        ? `record(${input.fields.map((f) => f.name.name).join(", ")})`
        : `tuple(${input.components.map((c) => c.name.name).join(", ")})`,
  );
}

const LABEL = { Process: "Process", Agent: "Agent", Workflow: "Workflow" };

export interface ArityMismatch {
  readonly call: MethodCall;
  readonly label: string;
  readonly name: string;
  readonly names: readonly string[];
  readonly got: number;
}

/** The calls of processes, agents and named workflows with the wrong number of arguments (pipeline calls are typed). */
export function arityMismatches(context: LintContext): ArityMismatch[] {
  const ast = scriptOf(context);
  if (!ast) return [];
  const out: ArityMismatch[] = [];
  walk(ast, (node) => {
    if (node.kind !== "MethodCall") return undefined;
    const call = node as MethodCall;
    if (call.receiver !== null) return undefined;
    const name = methodName(call);
    const declaration = context.lookup(name)?.declaration;
    if (
      !declaration ||
      (declaration.kind !== "Process" &&
        declaration.kind !== "Agent" &&
        declaration.kind !== "Workflow")
    )
      return undefined;
    const names = declaredInputs(declaration);
    const got = argumentCount(call);
    if (names && names.length !== got)
      out.push({
        call,
        label: LABEL[declaration.kind],
        name,
        names,
        got,
      });
    return undefined;
  });
  return out;
}

const inputAdvice = (names: readonly string[]): string =>
  names.length === 0
    ? "pass no arguments"
    : `pass one argument for each input: ${names.map((n) => `\`${n}\``).join(", ")}`;

/**
 * Ours: a `null` argument for a typed process input that isn't nullable. `nextflow lint` accepts it, but the run stops
 * with "input at index N cannot be null" (probed on 26.10.7), so the input is as good as unconnected.
 */
function nullArguments(context: LintContext): LintFinding[] {
  const ast = scriptOf(context);
  const out: LintFinding[] = [];
  if (!ast) return out;
  walk(ast, (node) => {
    if (node.kind !== "MethodCall" || (node as MethodCall).receiver !== null)
      return undefined;
    const call = node as MethodCall;
    const declaration = context.lookup(methodName(call))?.declaration;
    if (declaration?.kind !== "Process" || !declaration.typed) return undefined;
    const inputs = declaration.inputs?.items ?? [];
    const args = call.args;
    if (
      inputs.length !== argumentCount(call) ||
      args.some((a) => a.kind === "NamedArgument") ||
      call.closures.length > 0
    )
      return undefined;
    args.forEach((arg, i) => {
      const input = inputs[i];
      if (
        arg.kind === "Null" &&
        input?.kind === "TypedName" &&
        input.type !== null &&
        !input.type.nullable
      )
        out.push({
          range: arg.range,
          message: `Input \`${input.name.name}\` of process \`${methodName(call)}\` is not nullable but receives \`null\` -- pass a value, or add \`?\` to the input's type`,
        });
    });
    return undefined;
  });
  return out;
}

/**
 * `TypeCheckingVisitor.java#L648` (typed scripts, reported at the method name) and `CallArityVisitor.java#L73` (legacy
 * scripts, at the call). Named arguments count once and closures count, as nf-lang counts them.
 */
export const callArity: LintRule = {
  code: "call-arity",
  check: (context) => {
    const typed = scriptOf(context)?.typesEnabled ?? false;
    return [
      ...arityMismatches(context).map(
        ({ call, label, name, names, got }): LintFinding =>
          typed
            ? {
                range: call.method.range,
                message: `${label} \`${name}\` expects ${names.length} argument(s) but received ${got} -- ${inputAdvice(names)}`,
              }
            : {
                range: call.range,
                message: `Incorrect number of call arguments, expected ${names.length} but received ${got} -- ${inputAdvice(names)}`,
              },
      ),
      ...(typed ? nullArguments(context) : []),
    ];
  },
};

const TRY = "connect it, publish it, or remove the call";

/** A process whose results are routed elsewhere without a read in the workflow: topics and `publishDir`. */
function routesOutputs(process: ProcessDef): boolean {
  if (process.typed && (process.topics?.items.length ?? 0) > 0) return true;
  if (
    !process.typed &&
    (process.outputs?.items ?? []).some(
      (o) =>
        o.expression.kind === "MethodCall" &&
        o.expression.args.some(
          (a) =>
            a.kind === "NamedArgument" &&
            (a.name.kind === "Identifier" ? a.name.name : a.name.value) ===
              "topic",
        ),
    )
  )
    return true;
  return directiveCalls(process).some((c) => methodName(c) === "publishDir");
}

/** The named outputs of a typed process with several, else null. */
function severalOutputs(process: ProcessDef): readonly string[] | null {
  if (!process.typed) return null;
  const items = process.outputs?.items ?? [];
  if (items.length < 2) return null;
  const names: string[] = [];
  for (const item of items) {
    if (item.kind !== "NamedOutput") return null;
    names.push(item.name.name);
  }
  return names;
}

/**
 * Ours (LA-33): a call in a workflow's `main` whose outputs nothing reads. A bare call warns unless a legacy script reads
 * `<name>.out`; an assigned call warns when the variable isn't read after the statement; a typed call with several
 * outputs warns for each output never read. Topics, a `publishDir` directive and a config `publishDir` exempt the call.
 */
export const unusedOutput: LintRule = {
  code: "unused-output",
  check: (context) => {
    const ast = scriptOf(context);
    if (!ast) return [];
    let configRoutes: boolean | undefined;
    const out: LintFinding[] = [];
    for (const def of ast.body) {
      if (def.kind !== "Workflow") continue;
      for (const { call, statement, assigned } of workflowCalls(
        def as WorkflowDef,
      )) {
        const name = methodName(call);
        const declaration = context.lookup(name)?.declaration;
        if (declaration?.kind !== "Process") continue;
        if ((declaration.outputs?.items.length ?? 0) === 0) continue;
        if (routesOutputs(declaration)) continue;
        configRoutes ??= configPublishes(context.configs());
        if (configRoutes) continue;
        const range = call.range;
        if (assigned === null) {
          const reads = readsIn([def]).get(name) ?? [];
          if (!declaration.typed && reads.some((r) => r.property === "out"))
            continue;
          out.push({
            range,
            message: `The outputs of \`${name}\` are never used -- ${TRY}`,
          });
          continue;
        }
        const reads = readsIn([def], statement.range.end).get(assigned) ?? [];
        if (reads.length === 0) {
          out.push({
            range,
            message: `The result of \`${name}\` is never used -- ${TRY}`,
          });
          continue;
        }
        const names = severalOutputs(declaration);
        if (names && !reads.some((r) => r.whole))
          for (const output of names)
            if (!reads.some((r) => r.property === output))
              out.push({
                range,
                message: `Output \`${output}\` of \`${name}\` is never used -- ${TRY}`,
              });
      }
    }
    return out;
  },
};

/**
 * Ours (AR-05, LA-33): a process called twice in one workflow. Nextflow 26.10.7 stops the run with "Process 'X' was called
 * twice", and `nextflow lint` accepts it (upstream bug 24). A call, or a name used as a pipe operand, counts; reading
 * `X.out` doesn't. Only a certain repeat is reported: the earlier call must run whenever the later one does, so both
 * sit in the same branch or the later one is nested in the earlier one's. Calls under different conditions (the two
 * branches of an `if`, or two separate `if` statements as in sarek's `fastq_preprocess_gatk`) may be alternatives, and
 * the pack can't tell. A workflow may be called twice.
 */
export const duplicateCall: LintRule = {
  code: "duplicate-call",
  check: (context) => {
    const ast = scriptOf(context);
    if (!ast) return [];
    const out: LintFinding[] = [];
    const isProcess = (name: string): boolean =>
      context.lookup(name)?.declaration?.kind === "Process";
    for (const def of ast.body) {
      if (def.kind !== "Workflow" || !def.main) continue;
      // the branch of each enclosing `if`: "<if number>.then" or "<if number>.else"
      const path: string[] = [];
      let ifs = 0;
      const seen = new Map<string, string[][]>();
      const note = (name: string, range: LintFinding["range"]): void => {
        if (!isProcess(name)) return;
        const earlier = seen.get(name) ?? [];
        if (
          earlier.some((before) => before.every((step, i) => path[i] === step))
        )
          out.push({
            range,
            message: `Process \`${name}\` is already called in this workflow -- include it again under another name (\`include { ${name} as ${name}_2 }\`) to call it twice`,
          });
        seen.set(name, [...earlier, [...path]]);
      };
      const go = (node: AstNode): void => {
        if (node.kind === "If") {
          const branch = node as IfStatement;
          const id = ifs++;
          go(branch.condition);
          path.push(`${id}.then`);
          go(branch.consequent);
          path.pop();
          if (branch.alternate) {
            path.push(`${id}.else`);
            go(branch.alternate);
            path.pop();
          }
          return;
        }
        if (node.kind === "MethodCall") {
          const call = node as MethodCall;
          if (call.receiver === null) note(methodName(call), call.range);
        } else if (node.kind === "Binary") {
          const pipe = node as BinaryExpr;
          if (pipe.operator === "|")
            for (const side of [pipe.left, pipe.right])
              if (side.kind === "Variable") note(side.name, side.range);
        }
        for (const child of childNodes(node)) go(child);
      };
      go(def.main as unknown as AstNode);
    }
    return out;
  },
};
