import type { NodeBase } from "./range.ts";

/** Any AST node, script or config. */
export type AstNode = NodeBase<string>;

// Properties that hold comments, not child nodes. Ranges (`range`, `labelRange`, `elseRange`) have no `kind`, so they
// are skipped without being listed.
const NOT_CHILDREN = new Set([
  "leadingComments",
  "trailingComments",
  "danglingComments",
  "comments",
  "shebang",
]);

export const isAstNode = (value: unknown): value is AstNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { kind?: unknown }).kind === "string" &&
  typeof (value as { range?: unknown }).range === "object";

/** The fields of `node` that can hold child nodes, in field order: everything but the comment slots. */
export function childFields(node: AstNode): [string, unknown][] {
  return Object.entries(node).filter(([key]) => !NOT_CHILDREN.has(key));
}

/**
 * Child nodes in field order (builders create fields in source order). Ranges, comment slots and
 * `ScriptAst.comments`/`shebang` are not nodes. Works for any node kind, so config nodes need no change here.
 */
export function childNodes<N extends AstNode>(node: N): AstNode[] {
  const out: AstNode[] = [];
  for (const [, value] of childFields(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) out.push(item);
    } else if (isAstNode(value)) {
      out.push(value);
    }
  }
  return out;
}

/** Depth-first, parents first; return false from `visit` to skip a subtree. */
export function walk(
  node: AstNode,
  visit: (node: AstNode, parent: AstNode | null) => undefined | false,
  parent: AstNode | null = null,
): void {
  if (visit(node, parent) === false) return;
  for (const child of childNodes(node)) walk(child, visit, node);
}
