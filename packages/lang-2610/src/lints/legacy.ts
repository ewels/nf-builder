// Rules for legacy patterns (LA-35, LA-36, F-112): suggestions that a modern form exists. They never migrate on their own
// (ADR 0007), so none carries a quick fix.
import {
  type AstNode,
  type FormalParameter,
  type LintFinding,
  type LintRule,
  type MethodCall,
  type ProcessDef,
  type Range,
  type TypedName,
  type TypedProcess,
  type Variable,
  walk,
} from "@nf-builder/lang-core";
import { directiveCalls, methodName, scriptOf } from "./scan.ts";

const MIGRATE =
  "migrate it to static types: give it its own script with `nextflow.enable.types = true` and typed inputs and outputs";

const body = (context: Parameters<LintRule["check"]>[0]) =>
  scriptOf(context)?.body ?? [];

/** Ours (LA-35): a process with legacy inputs and outputs, at its name. */
export const legacyProcess: LintRule = {
  code: "legacy-process",
  check: (context) =>
    body(context).flatMap((item): LintFinding[] =>
      item.kind === "Process" && !item.typed
        ? [
            {
              range: item.name.range,
              message: `Process \`${item.name.name}\` uses legacy inputs and outputs -- ${MIGRATE}`,
            },
          ]
        : [],
    ),
};

/** The `workflow` keyword of a workflow: its definition starts there. */
const keywordRange = (range: Range): Range => ({
  start: range.start,
  end: range.start + "workflow".length,
  line: range.line,
  column: range.column,
  endLine: range.line,
  endColumn: range.column + "workflow".length,
});

/** Ours (LA-35): a workflow written in the legacy syntax, at its name (the keyword for the entry workflow). */
export const legacyWorkflow: LintRule = {
  code: "legacy-workflow",
  check: (context) =>
    body(context).flatMap((item): LintFinding[] =>
      item.kind === "Workflow" && !item.typed
        ? [
            {
              range: item.name ? item.name.range : keywordRange(item.range),
              message: `${item.name ? `Workflow \`${item.name.name}\`` : "The entry workflow"} is written in the legacy syntax -- ${MIGRATE}`,
            },
          ]
        : [],
    ),
};

/** `VariableScopeVisitor.java#L271` (paranoid): `params.x = value`. */
export const legacyParams: LintRule = {
  code: "legacy-params",
  check: (context) =>
    body(context).flatMap((item): LintFinding[] =>
      item.kind === "LegacyParam"
        ? [
            {
              range: item.range,
              message:
                "Legacy parameter declarations are discouraged -- use the `params` block instead",
            },
          ]
        : [],
    ),
};

/** Whether the subtree declares `params` itself (a parameter, input, take or local), which shadows the global. */
const declaresParams = (root: AstNode): boolean => {
  let found = false;
  walk(root, (node) => {
    if (
      (node.kind === "Parameter" || node.kind === "TypedName") &&
      (node as FormalParameter | TypedName).name.name === "params"
    )
      found = true;
    return found ? false : undefined;
  });
  return found;
};

/** `VariableScopeVisitor.java#L875` (paranoid): reads of `params` in processes, agents, functions and named workflows. */
export const paramsOutsideEntry: LintRule = {
  code: "params-outside-entry",
  check: (context) => {
    const out: LintFinding[] = [];
    for (const item of body(context)) {
      const outside =
        item.kind === "Process" ||
        item.kind === "Agent" ||
        item.kind === "Function" ||
        (item.kind === "Workflow" && item.name !== null);
      if (!outside || declaresParams(item)) continue;
      walk(item, (node) => {
        if (node.kind === "Variable" && (node as Variable).name === "params")
          out.push({
            range: node.range,
            message:
              "The use of `params` outside the entry workflow is discouraged -- pass the value in as an input instead",
          });
        return undefined;
      });
    }
    return out;
  },
};

const isTupleCall = (node: AstNode): node is MethodCall =>
  node.kind === "MethodCall" &&
  (node as MethodCall).receiver === null &&
  methodName(node as MethodCall) === "tuple";

/** Ours (LA-36): a typed process with a tuple input or a `tuple(...)` output. */
export const tupleWhereRecord: LintRule = {
  code: "tuple-where-record",
  check: (context) => {
    const out: LintFinding[] = [];
    const flag = (range: Range) =>
      out.push({
        range,
        message:
          "A tuple is matched by position -- use a record (`record(...)`) so values are matched by name",
      });
    for (const item of body(context)) {
      if (item.kind !== "Process" || !item.typed) continue;
      const process: TypedProcess = item;
      for (const input of process.inputs?.items ?? [])
        if (input.kind === "TupleInput") flag(input.range);
      for (const output of process.outputs?.items ?? []) {
        const value =
          output.kind === "NamedOutput" ? output.value : output.expression;
        if (value && isTupleCall(value)) flag(value.range);
      }
    }
    return out;
  },
};

/** Ours (deprecations.mdx, "Discouraged"): a `publishDir` directive in a script. */
export const publishDir: LintRule = {
  code: "publish-dir",
  check: (context) =>
    body(context).flatMap((item): LintFinding[] =>
      item.kind === "Process"
        ? directiveCalls(item as ProcessDef)
            .filter((call) => methodName(call) === "publishDir")
            .map((call) => ({
              range: call.range,
              message:
                "The `publishDir` directive is discouraged -- publish outputs from the entry workflow (`publish:` and the `output` block) instead",
            }))
        : [],
    ),
};
