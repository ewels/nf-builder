// Cleaning up assignments that nothing reads any more (F-310, ADR 0064): after a node is deleted or an input is
// disconnected, `x = P()` whose `x` is no longer read becomes the bare call `P()`, so no unused variable is left.
import {
  type Assignment,
  type ExpressionStatement,
  NO_RANGE,
  type Statement,
  type WorkflowDef,
  walk,
} from "@nf-builder/lang-core";
import type { EditState } from "./apply";
import { replaceNode } from "./nodes";

/** Every name the workflow reads: variables that aren't the target of a plain assignment. */
function readNames(def: WorkflowDef): Set<string> {
  const targets = new Set<unknown>();
  walk(def, (node) => {
    if (node.kind === "Assignment") targets.add((node as Assignment).target);
    return undefined;
  });
  const reads = new Set<string>();
  walk(def, (node) => {
    if (node.kind === "Variable" && !targets.has(node))
      reads.add((node as unknown as { name: string }).name);
    return undefined;
  });
  return reads;
}

/** Whether `name` is a process or workflow of the script at `path`, defined there or included from the project. */
export function callableIn(
  state: EditState,
  path: string,
): (name: string) => boolean {
  const isCallable = (kind: string | undefined) =>
    kind === "Process" || kind === "Workflow";
  return (name) => {
    const binding = state.model.lookup(path, name);
    if (!binding) return false;
    if (binding.kind === "declaration")
      return isCallable(binding.declaration.kind);
    if (binding.include.target.kind === "plugin" || binding.entry.pipeline)
      return false;
    return isCallable(binding.entry.declaration?.kind);
  };
}

/**
 * `after` with each top-level `name = CALLEE(...)` made a bare `CALLEE(...)` when `name` was read in `before` and is
 * read nowhere in `after`, and `CALLEE` is callable. Other assignments, and those already unread, are left alone.
 */
export function dropUnreadAssignments(
  before: WorkflowDef,
  after: WorkflowDef,
  isCallable: (name: string) => boolean,
): WorkflowDef {
  const was = readNames(before);
  const now = readNames(after);
  let result = after;
  for (const stmt of after.main?.items ?? []) {
    if (
      stmt.kind !== "Assignment" ||
      stmt.operator !== "=" ||
      stmt.target.kind !== "Variable" ||
      !was.has(stmt.target.name) ||
      now.has(stmt.target.name) ||
      stmt.value.kind !== "MethodCall" ||
      stmt.value.receiver !== null ||
      stmt.value.method.kind !== "Identifier" ||
      !isCallable(stmt.value.method.name)
    )
      continue;
    result = replaceNode(result, stmt as Statement, bare(stmt));
  }
  return result;
}

/** `stmt`'s call as a statement of its own; the comments around it stay. */
function bare(stmt: Assignment): ExpressionStatement {
  return {
    kind: "ExpressionStatement",
    expression: stmt.value,
    range: NO_RANGE,
    ...(stmt.leadingComments && { leadingComments: stmt.leadingComments }),
    ...(stmt.trailingComments && { trailingComments: stmt.trailingComments }),
    ...(stmt.danglingComments && { danglingComments: stmt.danglingComments }),
  };
}
