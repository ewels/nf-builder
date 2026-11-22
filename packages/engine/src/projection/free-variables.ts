// The variables a statement reads and assigns (AR-13, LA-27, ADR 0004): the basis of a code node's ports. A re-implementation
// of the scoping rules of nf-lang's VariableScopeVisitor (Apache-2.0, Nextflow v26.10.7, modules/nf-lang/src/main/java/
// nextflow/script/control/VariableScopeVisitor.java), checked against `nextflow lint` by the free-variable probe tree:
//  - L657-L678: an assignment without `def`, in a workflow, declares its name at workflow scope (an error inside closures);
//  - L603-L609: blocks open a scope; L612-L617: a catch block declares its variable;
//  - L620-L636: an assignment visits its value before its target;
//  - L685-L713: a mutated target's root (`x.p =`, `x[i] =`) is a read;
//  - L773-L786: `set` and `tap` declare their variable;
//  - L831 onwards: a declaration visits its initializer first.

import {
  type Assignment,
  type AstNode,
  type CatchClause,
  type Closure,
  childNodes,
  type Expression,
  type MethodCall,
  type Range,
  type Statement,
  type Variable,
  type VariableDeclaration,
} from "@nf-builder/lang-core";
import { setTarget } from "./legacy";

export interface FreeRead {
  readonly name: string;
  /** The simple property names after the variable (`params.reads` gives `reads`); the chain stops at an index, a call or `*.`. */
  readonly properties: readonly string[];
  readonly range: Range;
  /** The read is inside a closure of the statement. */
  readonly inClosure: boolean;
  /** The read is the target of a compound assignment (`x += 1`), which lint does not report. */
  readonly compoundTarget: boolean;
}

export interface Write {
  readonly name: string;
  readonly range: Range;
  /** A declaration form introduced the name (`def`, a tuple `def`, `set` or `tap`), rather than an assignment to it. */
  readonly declared: boolean;
}

export interface StatementVariables {
  /** Every occurrence of a variable the statement reads without having declared it, in visiting order. */
  readonly reads: readonly FreeRead[];
  /** The variables the statement assigns at workflow scope, once each, in first-write order. */
  readonly writes: readonly Write[];
}

/** The variables `statement` reads that nothing in it declares, and the workflow-scope variables it assigns. */
export function statementVariables(statement: Statement): StatementVariables {
  const reads: FreeRead[] = [];
  const writes: Write[] = [];
  /** Names declared in enclosing blocks, closures and catch clauses. */
  const scopes: Set<string>[] = [];
  /** Names this statement has declared at workflow scope so far. */
  const declared = new Set<string>();
  let closures = 0;

  const isLocal = (name: string): boolean => scopes.some((s) => s.has(name));
  const isDeclared = (name: string): boolean =>
    isLocal(name) || declared.has(name);
  const declareLocal = (name: string): void => {
    (scopes.at(-1) ?? declared).add(name);
  };
  const write = (name: string, range: Range, isDeclaration: boolean): void => {
    declared.add(name);
    if (!writes.some((w) => w.name === name))
      writes.push({ name, range, declared: isDeclaration });
  };
  const read = (
    name: string,
    properties: readonly string[],
    range: Range,
    compoundTarget = false,
  ): void => {
    if (isDeclared(name)) return;
    reads.push({
      name,
      properties,
      range,
      inClosure: closures > 0,
      compoundTarget,
    });
  };

  const visitClosure = (closure: Closure): void => {
    const names = new Set<string>();
    if (closure.params === null) names.add("it");
    else for (const p of closure.params) names.add(p.name.name);
    scopes.push(names);
    closures += 1;
    for (const p of closure.params ?? [])
      if (p.defaultValue !== null) visit(p.defaultValue);
    for (const s of closure.body) visit(s);
    closures -= 1;
    scopes.pop();
  };

  /** The variable at the root of `a.b.c` and the names after it, when every step is a plain `.` or `?.` property. */
  const chain = (
    expression: Expression,
  ): { name: string; range: Range; properties: string[] } | null => {
    const properties: string[] = [];
    let at = expression;
    while (
      at.kind === "Property" &&
      at.property.kind === "Identifier" &&
      at.navigation !== "*."
    ) {
      properties.unshift(at.property.name);
      at = at.object;
    }
    return at.kind === "Variable"
      ? { name: at.name, range: at.range, properties }
      : null;
  };

  const assign = (node: Assignment): void => {
    visit(node.value);
    const target = node.target;
    if (target.kind === "TupleTarget") {
      for (const name of target.names) bind(name.name, name.range, false);
    } else if (target.kind === "Variable") {
      if (node.operator !== "=") read(target.name, [], target.range, true);
      bind(target.name, target.range, false);
    } else visit(target);
  };

  /** An assignment to a name: local inside closures and when already block-local; otherwise a workflow-scope write. */
  const bind = (name: string, range: Range, isDeclaration: boolean): void => {
    if (closures > 0) {
      if (!isDeclared(name)) declareLocal(name);
    } else if (!isLocal(name)) write(name, range, isDeclaration);
  };

  const declaration = (node: VariableDeclaration): void => {
    if (node.initializer !== null) visit(node.initializer);
    for (const t of node.targets) {
      if (scopes.length === 0 && closures === 0)
        write(t.name.name, t.name.range, true);
      else declareLocal(t.name.name);
    }
  };

  const catchClause = (node: CatchClause): void => {
    scopes.push(new Set([node.variable.name]));
    visit(node.body);
    scopes.pop();
  };

  const visit = (node: AstNode): void => {
    const n = node as Expression | Statement | CatchClause;
    switch (n.kind) {
      case "Variable":
        read(n.name, [], n.range);
        return;
      case "Property": {
        const found = chain(n);
        if (found !== null) read(found.name, found.properties, found.range);
        else visit(n.object);
        return;
      }
      case "Closure":
        visitClosure(n);
        return;
      case "MethodCall": {
        const target = setTarget(n)?.variable ?? null;
        if (target !== null && n.receiver !== null) {
          visit(n.receiver);
          write(target.name, target.range, true);
          return;
        }
        if (n.receiver !== null) visit(n.receiver);
        for (const arg of n.args) visit(arg);
        for (const c of n.closures) visitClosure(c);
        return;
      }
      case "Block":
        scopes.push(new Set());
        for (const s of n.statements) visit(s);
        scopes.pop();
        return;
      case "VariableDeclaration":
        declaration(n);
        return;
      case "Assignment":
        assign(n);
        return;
      case "Catch":
        catchClause(n);
        return;
    }
    for (const child of childNodes(node)) visit(child);
  };

  visit(statement);
  return { reads, writes };
}
