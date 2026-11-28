import type {
  AstNode,
  Connect,
  Disconnect,
  Expression,
  MethodCall,
  NamedOutput,
  ScriptSourceFile,
  Statement,
  TextPatch,
  WorkflowDef,
} from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { builtinNames, isIdentifier, namesInWorkflow } from "../names";
import {
  assignment,
  findByRange,
  namedOutput,
  nullLiteral,
  replaceNode,
} from "../nodes";
import { EditRefusal } from "../refusal";
import { assertCommentsKept, reprintDeclaration } from "../splice";
import { callableIn, dropUnreadAssignments } from "../unread";
import {
  assignedNames,
  clearArgument,
  locateWorkflow,
  mentionedNames,
  portOf,
  referenceTo,
  topStatement,
} from "../workflow";

const invalid = (message: string) => new EditRefusal("invalid", message);

/**
 * Sets the value of the emit or publish item chosen by `match`. A bare `emit: x` gets `x = <expression>`; a lone
 * expression keeps the port name it had (`name`) by becoming a named output.
 */
function setValue(
  def: WorkflowDef,
  items: readonly (NamedOutput | Statement)[],
  match: (item: NamedOutput | Statement) => boolean,
  expression: Expression,
  name: string,
): WorkflowDef {
  const item = items.find(match);
  if (!item) throw invalid("That output isn't in the workflow's code.");
  if (item.kind === "NamedOutput") {
    const valued: NamedOutput = { ...item, value: expression };
    return replaceNode(def, item, valued);
  }
  if (!isIdentifier(name))
    throw invalid(
      "That output has no name to keep, so its value can't be replaced from here. Name it in the code first.",
    );
  return replaceNode(def, item, namedOutput(name, expression));
}

/** Everything a Connect decides before it prints: the workflow rewritten in the AST, and the nodes it replaced. */
export interface ConnectPlan {
  readonly file: ScriptSourceFile;
  readonly def: WorkflowDef;
  readonly next: WorkflowDef;
  readonly removed: readonly AstNode[];
}

/**
 * Makes every check and decision of Connect (UX-25) and builds the rewritten workflow in the AST, without printing
 * or reparsing it; refuses exactly as `connect` does (F-302). What only the reprint finds is not predicted.
 */
export function planConnect(state: EditState, command: Connect): ConnectPlan {
  const { file, def, projection } = locateWorkflow(state, command.target);
  const { node: from, port: out } = portOf(projection, command.from, "outputs");
  const { node: to, port: input } = portOf(projection, command.to, "inputs");
  if (from.id === to.id)
    throw invalid(`${from.label} can't be connected to itself.`);

  const items = def.main?.items ?? [];
  const scope = state.model.file(file.path)?.scope.keys() ?? [];
  const taken = new Set([
    ...namesInWorkflow(def),
    ...scope,
    ...builtinNames(state.catalogue),
  ]);
  const source = referenceTo(def, from, out, taken);

  // where the target reads: after all of `main` for emits and publishers
  const afterMain = to.kind === "emit" || to.kind === "output";
  const t = afterMain ? items.length : topStatement(def, to.range);
  if (t < 0) throw invalid(`${to.label} isn't in the workflow's main section.`);
  const s = source.statement;
  if (s === t)
    throw invalid(
      `${from.label} and ${to.label} are in the same statement; connecting them would make a cycle.`,
    );

  if (s > t) {
    const range = items.slice(t, s);
    const mine = items[s] as Statement;
    const assignedBetween = new Set(range.flatMap(assignedNames));
    const mentionedBetween = new Set(
      range.flatMap((x) => [...mentionedNames(x)]),
    );
    const reads = mentionedNames(mine);
    const clash =
      [...reads].some((n) => assignedBetween.has(n)) ||
      assignedNames(mine).some((n) => mentionedBetween.has(n));
    if (clash)
      throw invalid(
        `${to.label} comes before ${from.label} and ${from.label} depends on statements in between, so moving it up would create a cycle.`,
      );
  } else if (s >= 0 && source.variable !== null && !source.introduce) {
    const reassigned = items
      .slice(s + 1, t)
      .some((x) => assignedNames(x).includes(source.variable as string));
    if (reassigned)
      throw invalid(
        `${source.variable} is assigned again before ${to.label}, so connecting it there would read the wrong value.`,
      );
  }

  // the target side
  const removed: AstNode[] = [];
  let updated: WorkflowDef;
  if (to.kind === "emit") {
    updated = setValue(
      def,
      def.emits?.items ?? [],
      (i) => i.range.start === to.range.start,
      source.expression,
      to.label,
    );
  } else if (to.kind === "output") {
    updated = setValue(
      def,
      def.publishers?.items ?? [],
      (i) => i.kind === "NamedOutput" && i.name.name === command.to.port,
      source.expression,
      command.to.port,
    );
  } else if (input.argument) {
    const old = findByRange(def, input.argument);
    if (!old)
      throw new EditRefusal(
        "internal",
        "The argument to replace was not found.",
        file.path,
      );
    removed.push(old);
    updated = replaceNode(def, old, source.expression);
  } else if (to.kind === "call") {
    const expression = findByRange(def, to.range);
    if (expression?.kind !== "MethodCall")
      throw invalid(`${to.label} can't take another argument.`);
    const args = expression.args;
    const index = to.inputs.indexOf(input);
    const positional = args.filter((a) => a.kind !== "NamedArgument");
    if (positional.length > index)
      throw invalid(`${to.label} already has an argument there.`);
    const padded = [
      ...positional,
      ...Array.from({ length: index - positional.length }, nullLiteral),
      source.expression,
    ];
    const named = args.filter((a) => a.kind === "NamedArgument");
    const extended: MethodCall = { ...expression, args: [...padded, ...named] };
    updated = replaceNode(def, expression, extended);
  } else {
    throw invalid(`${to.label} can't take another argument.`);
  }

  // the source side: give it a variable, then move it above the target if it comes after
  let list: readonly Statement[] = updated.main?.items ?? [];
  if (source.introduce) {
    const stmt = list[s] as Statement & { expression: Expression };
    list = list.map((x, i) =>
      i === s
        ? assignment(source.variable as string, stmt.expression, stmt)
        : x,
    );
  }
  if (s > t) {
    const moving = list[s] as Statement;
    list = [
      ...list.slice(0, t),
      moving,
      ...list.slice(t, s),
      ...list.slice(s + 1),
    ];
  }
  const main = updated.main && { ...updated.main, items: list };
  const next = { ...updated, main: main ?? null };
  assertCommentsKept(file, def, next, removed);
  return { file, def, next, removed };
}

/** Feeds the output port `from` into the input port `to` of the same workflow (UX-25). */
export function connect(state: EditState, command: Connect): TextPatch[] {
  const { file, def, next, removed } = planConnect(state, command);
  const edit = reprintDeclaration(
    file,
    def,
    next,
    state.parser.printer,
    removed,
  );
  return [{ kind: "edit", path: file.path, edits: [edit] }];
}

/** Removes the argument that feeds an input port. */
export function disconnect(state: EditState, command: Disconnect): TextPatch[] {
  const { file, def, projection } = locateWorkflow(state, command.target);
  const { node, port } = portOf(projection, command.port, "inputs");
  if (node.kind === "emit" || node.kind === "output")
    throw invalid(
      `The value of ${node.label} can't be disconnected; change or delete it in the code.`,
    );
  if (node.kind === "chain" && command.port.port === "in")
    throw invalid(
      `${node.label} needs its input channel; connect another one instead.`,
    );
  if (!port.argument)
    throw invalid(
      `${node.label} has nothing connected to ${command.port.port}.`,
    );
  const cleared = clearArgument(def, port.argument);
  if (!cleared)
    throw invalid(
      `The input of ${node.label} can't be disconnected from here.`,
    );
  const edit = reprintDeclaration(
    file,
    def,
    dropUnreadAssignments(def, cleared.def, callableIn(state, file.path)),
    state.parser.printer,
    [cleared.removed],
  );
  return [{ kind: "edit", path: file.path, edits: [edit] }];
}
