// Synthesised AST nodes and tree surgery for edit commands (F-111). New nodes have `NO_RANGE`, so the printer lays them
// out freshly (ADR 0032); positioned children keep their layout.
import {
  type Assignment,
  type AstNode,
  type Comment,
  childFields,
  type Expression,
  type ExpressionStatement,
  type Identifier,
  type Include,
  isAstNode,
  type MethodCall,
  type NamedOutput,
  NO_RANGE,
  type NullLiteral,
  type PropertyExpr,
  type Range,
  type StringLiteral,
  type Variable,
  walk,
} from "@nf-builder/lang-core";

type Slots = Pick<
  AstNode,
  "leadingComments" | "trailingComments" | "danglingComments"
>;

export const identifier = (name: string): Identifier => ({
  kind: "Identifier",
  name,
  range: NO_RANGE,
});

export const variable = (name: string): Variable => ({
  kind: "Variable",
  name,
  range: NO_RANGE,
});

export const property = (object: Expression, name: string): PropertyExpr => ({
  kind: "Property",
  object,
  navigation: ".",
  property: identifier(name),
  range: NO_RANGE,
});

/** `object[n]`: a legacy output read by position. */
export const indexAt = (object: Expression, n: number): Expression => ({
  kind: "Index",
  object,
  indices: [
    { kind: "Number", text: String(n), integer: true, range: NO_RANGE },
  ],
  range: NO_RANGE,
});

export const nullLiteral = (): NullLiteral => ({
  kind: "Null",
  range: NO_RANGE,
});

/** A single-quoted string. */
export const stringLiteral = (value: string): StringLiteral => ({
  kind: "String",
  text: `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
  value,
  quote: "'",
  range: NO_RANGE,
});

/** `name(args)`: an implicit-receiver call with parentheses. */
export const call = (
  name: string,
  args: readonly Expression[],
): MethodCall => ({
  kind: "MethodCall",
  receiver: null,
  navigation: null,
  method: identifier(name),
  args,
  parens: true,
  trailingComma: false,
  closures: [],
  range: NO_RANGE,
});

export const expressionStatement = (
  expression: Expression,
): ExpressionStatement => ({
  kind: "ExpressionStatement",
  expression,
  range: NO_RANGE,
});

/** `name = value`; the comment slots of `slotsFrom` (the statement it replaces) move to the new statement. */
export const assignment = (
  name: string,
  value: Expression,
  slotsFrom?: Slots,
): Assignment => ({
  kind: "Assignment",
  target: variable(name),
  operator: "=",
  value,
  range: NO_RANGE,
  ...copySlots(slotsFrom),
});

function copySlots(from: Slots | undefined): Slots {
  const out: {
    leadingComments?: readonly Comment[];
    trailingComments?: readonly Comment[];
    danglingComments?: readonly Comment[];
  } = {};
  if (from?.leadingComments) out.leadingComments = from.leadingComments;
  if (from?.trailingComments) out.trailingComments = from.trailingComments;
  if (from?.danglingComments) out.danglingComments = from.danglingComments;
  return out;
}

/** `name = value` as an emit or publish item. */
export const namedOutput = (name: string, value: Expression): NamedOutput => ({
  kind: "NamedOutput",
  name: identifier(name),
  type: null,
  value,
  range: NO_RANGE,
});

/** `include { name } from 'source'`, or `include { name as alias } from 'source'`. */
export const includeOf = (
  name: string,
  source: string,
  alias: string | null = null,
): Include => ({
  kind: "Include",
  entries: [
    {
      kind: "IncludeEntry",
      name: identifier(name),
      alias: alias === null ? null : identifier(alias),
      range: NO_RANGE,
    },
  ],
  source: stringLiteral(source),
  range: NO_RANGE,
});

/**
 * `root` with `target` (by identity) replaced; `null` removes it from its array, or sets a single field to null.
 * Untouched subtrees are shared; `root` itself comes back when `target` isn't in it.
 */
export function replaceNode<T extends AstNode>(
  root: T,
  target: AstNode,
  replacement: AstNode | null,
): T {
  const visit = (node: AstNode): AstNode | null => {
    if (node === target) return replacement;
    let copy: Record<string, unknown> | null = null;
    for (const [key, value] of childFields(node)) {
      let next: unknown = value;
      if (Array.isArray(value)) {
        let changed = false;
        const items: unknown[] = [];
        for (const item of value) {
          const out = isAstNode(item) ? visit(item) : item;
          if (out !== item) changed = true;
          if (out !== null) items.push(out);
        }
        if (changed) next = items;
      } else if (isAstNode(value)) {
        next = visit(value);
      }
      if (next !== value) {
        copy ??= { ...node };
        copy[key] = next;
      }
    }
    return copy ? (copy as unknown as AstNode) : node;
  };
  return visit(root) as T;
}

const EXPRESSIONS = new Set([
  "Variable",
  "Number",
  "String",
  "Boolean",
  "Null",
  "GString",
  "List",
  "Map",
  "Closure",
  "Property",
  "Index",
  "MethodCall",
  "Call",
  "New",
  "Unary",
  "Binary",
  "Cast",
  "TypeTest",
  "Ternary",
  "Elvis",
  "Parenthesized",
  "IncompleteExpression",
]);

/** The outermost expression under `root` whose range is exactly `range`; null when there is none. */
export function findByRange(root: AstNode, range: Range): Expression | null {
  let found: Expression | null = null;
  walk(root, (node) => {
    if (found) return false;
    if (
      EXPRESSIONS.has(node.kind) &&
      node.range.start === range.start &&
      node.range.end === range.end
    ) {
      found = node as Expression;
      return false;
    }
    return undefined;
  });
  return found;
}

/** Every comment in the slots of the subtree under `node`, the node included. */
export function attachedComments(node: AstNode): Comment[] {
  const out: Comment[] = [];
  walk(node, (n) => {
    out.push(
      ...(n.leadingComments ?? []),
      ...(n.trailingComments ?? []),
      ...(n.danglingComments ?? []),
    );
    return undefined;
  });
  return out;
}
