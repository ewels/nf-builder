// The variables an expression reads (AR-10). The start of F-108's free-variable analysis, and what F-106's wiring uses to
// find graph values read by an argument.

import {
  type AstNode,
  type Closure,
  childNodes,
  type Expression,
  type NamedArgument,
  type Range,
  type Statement,
} from "@nf-builder/lang-core";

export interface Read {
  readonly name: string;
  /** The first property read from the variable (`params.a.b` gives `a`); null when it is read whole. */
  readonly property: string | null;
  /** The whole chain of simple property names read from the variable (`a`, `b`). */
  readonly properties: readonly string[];
  /** The variable's name in the source. */
  readonly range: Range;
}

export interface ReadOptions {
  /** Count reads inside closures (default true). Closure parameters, implicit `it` and closure-local `def`s never count. */
  readonly closures?: boolean;
}

/** The variable at the root of `a.b.c` and the names after it, when every step is a simple property; null otherwise. */
function propertyChain(
  expression: Expression,
): { name: string; range: Range; properties: string[] } | null {
  const properties: string[] = [];
  let at = expression;
  while (at.kind === "Property" && at.property.kind === "Identifier") {
    properties.unshift(at.property.name);
    at = at.object;
  }
  return at.kind === "Variable"
    ? { name: at.name, range: at.range, properties }
    : null;
}

/** The variables `expression` reads, in source order. Property, method and named-argument keys aren't reads. */
export function variablesRead(
  expression: AstNode,
  options: ReadOptions = {},
): readonly Read[] {
  const closures = options.closures ?? true;
  const reads: Read[] = [];

  const visitClosure = (closure: Closure, outer: Set<string>): void => {
    if (!closures) return;
    const locals = new Set(outer);
    if (closure.params === null) locals.add("it");
    else for (const p of closure.params) locals.add(p.name.name);
    for (const statement of closure.body) visit(statement, locals);
  };

  const visit = (node: AstNode, locals: Set<string>): void => {
    const n = node as Expression | Statement | NamedArgument;
    switch (n.kind) {
      case "Variable":
        if (!locals.has(n.name))
          reads.push({
            name: n.name,
            property: null,
            properties: [],
            range: n.range,
          });
        return;
      case "Property": {
        const chain = propertyChain(n);
        if (chain === null) break;
        if (!locals.has(chain.name))
          reads.push({
            name: chain.name,
            property: chain.properties[0] ?? null,
            properties: chain.properties,
            range: chain.range,
          });
        return;
      }
      case "Closure":
        visitClosure(n, locals);
        return;
      case "NamedArgument":
        visit(n.value, locals);
        return;
      case "MethodCall":
        if (n.receiver !== null) visit(n.receiver, locals);
        for (const arg of n.args) visit(arg, locals);
        for (const closure of n.closures) visitClosure(closure, locals);
        return;
      case "VariableDeclaration":
        if (n.initializer !== null) visit(n.initializer, locals);
        // a `def` is local from here on
        for (const t of n.targets) locals.add(t.name.name);
        return;
      case "Assignment":
        // an assigned name or tuple isn't read; a compound or indexed target is
        if (
          (n.target.kind === "Variable" && n.operator === "=") ||
          n.target.kind === "TupleTarget"
        )
          visit(n.value, locals);
        else for (const child of childNodes(n)) visit(child, locals);
        return;
    }
    for (const child of childNodes(node)) visit(child, locals);
  };

  visit(expression, new Set<string>());
  return reads;
}
