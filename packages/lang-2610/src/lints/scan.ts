// Shared scans over the script and config ASTs for the lint rules (F-112). Pure functions over plain data.
import {
  type AgentDef,
  type AstNode,
  type CatchClause,
  type Closure,
  childNodes,
  type LintContext,
  type MethodCall,
  type ProcessDef,
  type ScriptAst,
  type Variable,
  type VariableDeclaration,
} from "@nf-builder/lang-core";

/** The file's script AST, or null for a config or a file nothing could be modelled in. */
export const scriptOf = (context: LintContext): ScriptAst | null =>
  context.file.language === "nextflow" ? context.file.ast : null;

/** A call's method name; a quoted name gives its value. */
export const methodName = (call: MethodCall): string =>
  call.method.kind === "Identifier" ? call.method.name : call.method.value;

interface Frame {
  readonly closure: Closure | null;
  readonly names: Set<string>;
}

/**
 * Calls `visit` for each `it` that nf-lang resolves to the implicit parameter of a closure: the nearest scope that
 * declares `it` is a closure with no declared parameters, so not a declared parameter, a `def it` or a catch variable.
 * Block, closure and catch bodies are scopes.
 */
export function forEachIt(
  root: AstNode,
  visit: (it: Variable, closure: Closure) => void,
): void {
  const frames: Frame[] = [];
  const resolve = (it: Variable): void => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i] as Frame;
      if (frame.names.has("it")) return;
      const { closure } = frame;
      if (closure && (closure.params === null || closure.params.length === 0)) {
        visit(it, closure);
        return;
      }
    }
  };
  const go = (node: AstNode): void => {
    let scope = false;
    if (node.kind === "Closure") {
      const closure = node as Closure;
      const names = new Set((closure.params ?? []).map((p) => p.name.name));
      frames.push({ closure, names });
      scope = true;
    } else if (node.kind === "Block") {
      frames.push({ closure: null, names: new Set() });
      scope = true;
    } else if (node.kind === "Catch") {
      const variable = (node as CatchClause).variable.name;
      frames.push({ closure: null, names: new Set([variable]) });
      scope = true;
    } else if (node.kind === "VariableDeclaration") {
      for (const target of (node as VariableDeclaration).targets)
        frames[frames.length - 1]?.names.add(target.name.name);
    } else if (node.kind === "Variable" && (node as Variable).name === "it") {
      resolve(node as Variable);
    }
    for (const child of childNodes(node)) go(child);
    if (scope) frames.pop();
  };
  go(root);
}

/** The directive calls of a process or agent, in source order (`cpus 1`, `publishDir 'x', mode: 'copy'`). */
export function directiveCalls(
  def: ProcessDef | AgentDef,
): readonly MethodCall[] {
  const out: MethodCall[] = [];
  for (const statement of def.directives?.items ?? [])
    if (
      statement.expression.kind === "MethodCall" &&
      statement.expression.receiver === null
    )
      out.push(statement.expression);
  return out;
}
