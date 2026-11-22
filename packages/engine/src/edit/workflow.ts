// Locating the workflow and nodes a command targets, and the argument surgery shared by Connect, Disconnect and
// DeleteNode (F-111). Node ids and ranges come from the projection (F-106); every function here is pure.
import {
  type Argument,
  type AstNode,
  type Expression,
  type GraphNode,
  type PortRef,
  type Projection,
  type Range,
  type ScriptSourceFile,
  type Statement,
  type WorkflowDef,
  type WorkflowTarget,
  walk,
} from "@nf-builder/lang-core";
import { parseNodeKey } from "../projection/keys";
import { createProjector } from "../projection/project";
import type { EditState } from "./apply";
import { freshName } from "./names";
import { nullLiteral, property, replaceNode, variable } from "./nodes";
import { EditRefusal } from "./refusal";

function findDefinition(
  state: EditState,
  target: WorkflowTarget,
): { file: ScriptSourceFile; def: WorkflowDef } {
  const file = state.model.file(target.path)?.source;
  if (!file)
    throw new EditRefusal(
      "not-found",
      `There is no file ${target.path}.`,
      target.path,
    );
  if (file.language !== "nextflow" || file.ast === null)
    throw new EditRefusal(
      "invalid",
      `${target.path} has no parsed Nextflow code to edit.`,
      target.path,
    );
  const label =
    target.workflow === null
      ? "The entry workflow"
      : `Workflow ${target.workflow}`;
  for (const item of file.ast.body) {
    if (
      item.kind === "Workflow" &&
      (item.name?.name ?? null) === target.workflow
    )
      return { file, def: item };
    if (
      item.kind === "Unparsed" &&
      item.head?.keyword === "workflow" &&
      item.head.name === target.workflow
    )
      throw new EditRefusal(
        "invalid",
        `${label} in ${target.path} has code that doesn't parse. Fix it in the Code tab first.`,
        target.path,
      );
  }
  throw new EditRefusal(
    "not-found",
    target.workflow === null &&
      file.ast.body.some(
        (i) =>
          i.kind !== "FeatureFlag" &&
          i.kind !== "Include" &&
          i.kind !== "Process" &&
          i.kind !== "Workflow",
      )
      ? `${target.path} has statements outside a workflow block; the builder can't edit them.`
      : `${label} is not defined in ${target.path}.`,
    target.path,
  );
}

/** The script, the named (or entry) workflow of `target` and its projection; refuses what can't be edited. */
export function locateWorkflow(
  state: EditState,
  target: WorkflowTarget,
): { file: ScriptSourceFile; def: WorkflowDef; projection: Projection } {
  const { file, def } = findDefinition(state, target);
  const projection = createProjector(state.model, state.catalogue).project(
    target.path,
    target.workflow,
  );
  if (!projection)
    throw new EditRefusal(
      "invalid",
      `The workflow in ${target.path} can't be shown as a graph, so it can't be edited from it.`,
      target.path,
    );
  return { file, def, projection };
}

/** The graph node `ref` names; refuses an unknown node or port. */
export function nodeOf(
  projection: Projection,
  ref: PortRef,
  side: "inputs" | "outputs",
): GraphNode {
  const node = projection.nodes.find((n) => n.id === ref.node);
  if (!node)
    throw new EditRefusal("not-found", `There is no node ${ref.node}.`);
  if (!node[side].some((p) => p.id === ref.port))
    throw new EditRefusal(
      "not-found",
      `${node.label} has no ${side === "inputs" ? "input" : "output"} ${ref.port}.`,
    );
  return node;
}

const contains = (outer: Range, inner: Range) =>
  outer.start <= inner.start && inner.end <= outer.end;
const sameRange = (a: Range, b: Range) =>
  a.start === b.start && a.end === b.end;

/** The index of the top-level `main` statement that contains `range`; -1 when there is none. */
export function topStatement(def: WorkflowDef, range: Range): number {
  return (def.main?.items ?? []).findIndex((s) => contains(s.range, range));
}

/** The expression a statement stands for: its expression, an assignment's value or an initialiser. */
export function statementExpression(stmt: Statement): Expression | null {
  switch (stmt.kind) {
    case "ExpressionStatement":
      return stmt.expression;
    case "Assignment":
      return stmt.operator === "=" ? stmt.value : null;
    case "VariableDeclaration":
      return stmt.initializer;
    default:
      return null;
  }
}

/** The statement index when `node` is a whole top-level statement or its expression; -1 for a nested node. */
export function topLevelIndex(def: WorkflowDef, node: GraphNode): number {
  const s = topStatement(def, node.range);
  const stmt = def.main?.items[s];
  if (!stmt) return -1;
  const expression = statementExpression(stmt);
  return sameRange(stmt.range, node.range) ||
    (expression && sameRange(expression.range, node.range))
    ? s
    : -1;
}

/** The names a top-level statement assigns. */
export function assignedNames(stmt: Statement): string[] {
  if (stmt.kind === "VariableDeclaration")
    return stmt.targets.map((t) => t.name.name);
  if (stmt.kind === "Assignment") {
    if (stmt.target.kind === "Variable") return [stmt.target.name];
    if (stmt.target.kind === "TupleTarget")
      return stmt.target.names.map((n) => n.name);
  }
  return [];
}

/** Every variable name a subtree mentions. */
export function mentionedNames(node: AstNode): Set<string> {
  const out = new Set<string>();
  walk(node, (n) => {
    if (n.kind === "Variable") out.add((n as unknown as { name: string }).name);
    return undefined;
  });
  return out;
}

interface Owner {
  readonly owner: AstNode & { args: readonly Argument[] };
  /** The element of `args`: the argument itself, or the named argument holding it. */
  readonly element: Argument;
}

/** The call whose argument list holds the expression with exactly this range; null for a receiver or a nested position. */
export function argumentOwner(def: WorkflowDef, argument: Range): Owner | null {
  let found: Owner | null = null;
  walk(def, (node) => {
    if (found) return false;
    const args = (node as unknown as { args?: readonly Argument[] }).args;
    if (!Array.isArray(args)) return undefined;
    for (const element of args) {
      const value = element.kind === "NamedArgument" ? element.value : element;
      if (sameRange(value.range, argument)) {
        found = {
          owner: node as AstNode & { args: readonly Argument[] },
          element,
        };
        return false;
      }
    }
    return undefined;
  });
  return found;
}

/**
 * The workflow without the argument at `argument`: a named argument, or the last positional one, is removed; an earlier
 * positional one becomes `null` so the later ones keep their position (LA-33). `removed` is what was taken out.
 */
export function clearArgument(
  def: WorkflowDef,
  argument: Range,
): { def: WorkflowDef; removed: AstNode } {
  const found = argumentOwner(def, argument);
  if (!found)
    throw new EditRefusal(
      "invalid",
      "That argument isn't a plain argument of a call, so it can't be removed from here.",
    );
  const { owner, element } = found;
  const positional = owner.args.filter((a) => a.kind !== "NamedArgument");
  const last =
    element.kind !== "NamedArgument" && positional.at(-1) === element;
  const named = element.kind === "NamedArgument";
  return {
    def: replaceNode(def, element, named || last ? null : nullLiteral()),
    removed: element,
  };
}

export interface SourceReference {
  readonly expression: Expression;
  /** The variable the expression reads, for the order checks; null for params. */
  readonly variable: string | null;
  /** The top-level statement that makes the value; -1 for takes and params. */
  readonly statement: number;
  /** Set when the statement must first be assigned to a new variable. */
  readonly introduce: { statement: number; name: string } | null;
}

const identifierPart = (text: string) => text.replace(/[^A-Za-z0-9_]/g, "_");

/** How a downstream node reads the output port `from` (Connect, step 1). `taken` lists names a new variable must avoid. */
export function referenceTo(
  def: WorkflowDef,
  projection: Projection,
  from: PortRef,
  taken: ReadonlySet<string>,
): SourceReference {
  const node = nodeOf(projection, from, "outputs");
  const read = (base: string): Expression =>
    node.outputs.length > 1
      ? property(variable(base), from.port)
      : variable(base);
  switch (node.kind) {
    case "take":
      return {
        expression: variable(node.name),
        variable: node.name,
        statement: -1,
        introduce: null,
      };
    case "params":
      return {
        expression: property(variable("params"), from.port),
        variable: null,
        statement: -1,
        introduce: null,
      };
    case "code": {
      const s = topStatement(def, node.range);
      if (s < 0)
        throw new EditRefusal(
          "invalid",
          `${node.label} can't be connected from here.`,
        );
      return {
        expression: variable(from.port),
        variable: from.port,
        statement: s,
        introduce: null,
      };
    }
    case "call":
    case "chain":
    case "factory": {
      const s = topLevelIndex(def, node);
      if (s < 0)
        throw new EditRefusal(
          "invalid",
          `${node.label} is nested inside another expression, so it can't be connected from. Connect from the node that contains it.`,
        );
      const local = parseNodeKey(node.id)?.local;
      if (local?.kind === "assigned")
        return {
          expression: read(local.variable),
          variable: local.variable,
          statement: s,
          introduce: null,
        };
      const stmt = def.main?.items[s];
      if (stmt?.kind !== "ExpressionStatement")
        throw new EditRefusal(
          "invalid",
          `${node.label} isn't a plain statement, so it can't be given a variable.`,
        );
      const base =
        node.kind === "call"
          ? identifierPart(node.label.toLowerCase())
          : node.kind === "factory"
            ? `${identifierPart(node.factory)}_ch`
            : `${identifierPart(node.steps.at(-1)?.operator ?? "chain")}_ch`;
      const name = freshName(base, taken);
      return {
        expression: read(name),
        variable: name,
        statement: s,
        introduce: { statement: s, name },
      };
    }
    default:
      throw new EditRefusal(
        "invalid",
        `${node.label} has no value to connect from.`,
      );
  }
}
