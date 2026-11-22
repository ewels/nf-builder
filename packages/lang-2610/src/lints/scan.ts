// Shared scans over the script and config ASTs for the lint rules (F-112). Pure functions over plain data.
import {
  type AgentDef,
  type AstNode,
  type CatchClause,
  type Closure,
  type ConfigAst,
  type ConfigStatement,
  childNodes,
  type Expression,
  type Identifier,
  type LintContext,
  type MethodCall,
  type NamedOutput,
  type ProcessDef,
  type PropertyExpr,
  type ScriptAst,
  type ScriptItem,
  type Statement,
  type StringLiteral,
  type Variable,
  type VariableDeclaration,
  type WorkflowDef,
  walk,
} from "@nf-builder/lang-core";

/** The file's script AST, or null for a config or a file nothing could be modelled in. */
export const scriptOf = (context: LintContext): ScriptAst | null =>
  context.file.language === "nextflow" ? context.file.ast : null;

/** The script's top-level items; none for a config or a file nothing could be modelled in. */
export const bodyOf = (context: LintContext): readonly ScriptItem[] =>
  scriptOf(context)?.body ?? [];

/** A name written as an identifier or a quoted string (`foo`, `'foo'`). */
export const nameOf = (name: Identifier | StringLiteral): string =>
  name.kind === "Identifier" ? name.name : name.value;

/** A call's method name; a quoted name gives its value. */
export const methodName = (call: MethodCall): string => nameOf(call.method);

interface Frame {
  readonly closure: Closure | null;
  readonly names: Set<string>;
}

/**
 * Calls `visit` for each `it` that nf-lang resolves to the implicit parameter of a closure: the nearest scope that
 * declares `it` is a closure with no declared parameters, so not a declared parameter, a `def it` or a catch variable.
 * Block, closure and catch bodies are scopes. `shadows` is true when an enclosing scope already has `it` visible (a
 * frame that names it, or a closure with no parameters), so declaring `it` again would be an error.
 */
export function forEachIt(
  root: AstNode,
  visit: (it: Variable, closure: Closure, shadows: boolean) => void,
): void {
  const frames: Frame[] = [];
  const resolve = (it: Variable): void => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i] as Frame;
      if (frame.names.has("it")) return;
      const { closure } = frame;
      if (closure && (closure.params === null || closure.params.length === 0)) {
        const outer = frames.slice(0, i);
        visit(
          it,
          closure,
          outer.some(
            (f) =>
              f.names.has("it") ||
              (f.closure !== null &&
                (f.closure.params === null || f.closure.params.length === 0)),
          ),
        );
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

/** What reads of a name look like: the whole value (`r`) or one property (`r.out`, `r.txt`). */
interface Read {
  readonly whole: boolean;
  readonly property: string | null;
}

/**
 * The reads of each variable name under `root`, counting closures, GStrings and the implicit read of an emit or
 * output written as `name: Type` with no value. Only reads that start at or after `after` count.
 */
export function readsIn(
  root: AstNode,
  after = 0,
): ReadonlyMap<string, readonly Read[]> {
  const reads = new Map<string, Read[]>();
  const add = (name: string, read: Read): void => {
    const list = reads.get(name);
    if (list) list.push(read);
    else reads.set(name, [read]);
  };
  walk(root, (node, parent) => {
    if (node.range.end <= after) return false;
    if (node.kind === "NamedOutput") {
      const output = node as unknown as NamedOutput;
      if (output.value === null)
        add(output.name.name, { whole: true, property: null });
    } else if (node.kind === "Variable") {
      const name = (node as Variable).name;
      const owner =
        parent?.kind === "Property" ? (parent as PropertyExpr) : null;
      if (owner && owner.object === node)
        add(name, { whole: false, property: nameOf(owner.property) });
      else add(name, { whole: true, property: null });
    }
    return undefined;
  });
  return reads;
}

/** The positional arguments of a call, plus one if it has named arguments, plus its closures (nf-lang's argument count). */
export function argumentCount(call: MethodCall): number {
  const positional = call.args.filter((a) => a.kind !== "NamedArgument").length;
  const named = call.args.some((a) => a.kind === "NamedArgument") ? 1 : 0;
  return positional + named + call.closures.length;
}

interface WorkflowCall {
  readonly call: MethodCall;
  readonly statement: Statement;
  /** The variable the result is assigned to, `null` for a bare call. */
  readonly assigned: string | null;
}

const isBareCall = (e: Expression | null): e is MethodCall =>
  e?.kind === "MethodCall" && e.receiver === null;

/**
 * The calls in a workflow's `main` that stand as a whole statement: `CALL(...)`, `v = CALL(...)` and `def v = CALL(...)`,
 * also inside `if` branches. A call that is an argument, receiver or pipe operand is used, so it isn't listed.
 */
export function workflowCalls(def: WorkflowDef): readonly WorkflowCall[] {
  const out: WorkflowCall[] = [];
  const visit = (statement: Statement): void => {
    switch (statement.kind) {
      case "ExpressionStatement":
        if (isBareCall(statement.expression))
          out.push({ call: statement.expression, statement, assigned: null });
        break;
      case "Assignment":
        if (
          statement.operator === "=" &&
          statement.target.kind === "Variable" &&
          isBareCall(statement.value)
        )
          out.push({
            call: statement.value,
            statement,
            assigned: statement.target.name,
          });
        break;
      case "VariableDeclaration": {
        const [target] = statement.targets;
        if (
          !statement.multiple &&
          statement.targets.length === 1 &&
          target &&
          isBareCall(statement.initializer)
        )
          out.push({
            call: statement.initializer,
            statement,
            assigned: target.name.name,
          });
        break;
      }
      case "If":
        visit(statement.consequent);
        if (statement.alternate) visit(statement.alternate);
        break;
      case "Block":
        for (const inner of statement.statements) visit(inner);
        break;
    }
  };
  for (const statement of def.main?.items ?? []) visit(statement);
  return out;
}

/** Whether any config assigns `publishDir` for processes: `process.publishDir`, or inside a `process` block or selector. */
export function configPublishes(configs: readonly ConfigAst[]): boolean {
  const search = (
    statements: readonly ConfigStatement[],
    inProcess: boolean,
  ): boolean =>
    statements.some((s) => {
      switch (s.kind) {
        case "ConfigAssign": {
          const names = s.path.map((n) => n.name);
          return (
            names[names.length - 1] === "publishDir" &&
            (inProcess || names.includes("process"))
          );
        }
        case "ConfigBlock":
          return search(s.statements, inProcess || s.name.name === "process");
        case "ConfigSelector":
          return search(s.statements, true);
        default:
          return false;
      }
    });
  return configs.some((config) =>
    search(
      config.statements.filter(
        (s) => s.kind !== "Unparsed",
      ) as ConfigStatement[],
      false,
    ),
  );
}
