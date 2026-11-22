// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/Formatter.java
// (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE): the line numbers its wrapping rules read
// (`ASTNode.getLineNumber` and `getLastLineNumber`, -1 for a node with no position).
import type { AstNode, CallExpr, MethodCall } from "@nf-builder/lang-core";

/** `ASTNode.getLineNumber`: -1 for a node an edit created (`NO_RANGE`). */
export const line = (node: AstNode): number => node.range.line;

/** `ASTNode.getLastLineNumber`. */
export const lastLine = (node: AstNode): number => node.range.endLine;

/**
 * The last line of a call's argument list, the counterpart of `node.getArguments().getLastLineNumber()`. A trailing
 * closure starts on the line of the closing parenthesis (the grammar allows no newline between the arguments and the
 * closure), so that is its start line; without one, the call ends with its arguments.
 */
export function argumentsLastLine(call: MethodCall | CallExpr): number {
  const first = call.closures[0];
  return first ? line(first) : lastLine(call);
}

/** The line of the method name: `node.getMethod().getLineNumber()`. A `CallExpr` has no method node (upstream: -1). */
export function methodLine(call: MethodCall | CallExpr): number {
  return call.kind === "MethodCall" ? line(call.method) : -1;
}
