import type {
  Argument,
  AstNode,
  Connect,
  Disconnect,
  Expression,
  NamedOutput,
  Statement,
  TextPatch,
  WorkflowDef,
} from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { namesInWorkflow } from "../names";
import { assignment, findByRange, nullLiteral, replaceNode } from "../nodes";
import { EditRefusal } from "../refusal";
import { reprintDeclaration } from "../splice";
import {
  argumentOwner,
  assignedNames,
  clearArgument,
  locateWorkflow,
  mentionedNames,
  nodeOf,
  referenceTo,
  topStatement,
} from "../workflow";

const invalid = (message: string) => new EditRefusal("invalid", message);

/** Sets the value of the emit or publish item whose range starts where the node's does, or the named publisher. */
function setValue(
  def: WorkflowDef,
  items: readonly (NamedOutput | Statement)[],
  match: (item: NamedOutput | Statement) => boolean,
  expression: Expression,
): WorkflowDef {
  const item = items.find(match);
  if (!item) throw invalid("That output isn't in the workflow's code.");
  const updated =
    item.kind === "NamedOutput"
      ? { ...item, value: expression }
      : { ...item, expression };
  return replaceNode(def, item as AstNode, updated as AstNode);
}

/** Feeds the output port `from` into the input port `to` of the same workflow (UX-25). */
export function connect(state: EditState, command: Connect): TextPatch[] {
  const { file, def, projection } = locateWorkflow(state, command.target);
  const from = nodeOf(projection, command.from, "outputs");
  const to = nodeOf(projection, command.to, "inputs");
  if (from.id === to.id)
    throw invalid(`${from.label} can't be connected to itself.`);
  const input = to.inputs.find((p) => p.id === command.to.port);
  if (!input) throw invalid("That input doesn't exist.");
  if (
    to.kind === "take" ||
    to.kind === "factory" ||
    to.kind === "params" ||
    to.kind === "code"
  )
    throw invalid(`${to.label} has no input to connect to.`);

  const items = def.main?.items ?? [];
  const scope = state.model.file(file.path)?.scope.keys() ?? [];
  const taken = new Set([...namesInWorkflow(def), ...scope]);
  const source = referenceTo(def, projection, command.from, taken);

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
  } else if (s >= 0 && source.variable !== null && source.introduce === null) {
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
  if (input.argument) {
    const old = findByRange(def, input.argument);
    if (!old)
      throw new EditRefusal(
        "internal",
        "The argument to replace was not found.",
        file.path,
      );
    removed.push(old);
    updated = replaceNode(def, old, source.expression);
  } else if (to.kind === "emit") {
    updated = setValue(
      def,
      def.emits?.items ?? [],
      (i) => i.range.start === to.range.start,
      source.expression,
    );
  } else if (to.kind === "output") {
    updated = setValue(
      def,
      def.publishers?.items ?? [],
      (i) => i.kind === "NamedOutput" && i.name.name === command.to.port,
      source.expression,
    );
  } else if (to.kind === "call") {
    const expression = findByRange(def, to.range);
    if (expression?.kind !== "MethodCall")
      throw invalid(`${to.label} can't take another argument.`);
    const args = (expression as unknown as { args: readonly Argument[] }).args;
    const index = to.inputs.findIndex((p) => p.id === command.to.port);
    const positional = args.filter((a) => a.kind !== "NamedArgument");
    if (positional.length > index)
      throw invalid(`${to.label} already has an argument there.`);
    const padded = [
      ...positional,
      ...Array.from({ length: index - positional.length }, nullLiteral),
      source.expression,
    ];
    const named = args.filter((a) => a.kind === "NamedArgument");
    updated = replaceNode(def, expression, {
      ...expression,
      args: [...padded, ...named],
    } as AstNode);
  } else {
    throw invalid(`${to.label} can't take another argument.`);
  }

  // the source side: give it a variable, then move it above the target if it comes after
  let list: readonly Statement[] = updated.main?.items ?? [];
  if (source.introduce) {
    const stmt = list[s] as Statement & { expression: Expression };
    list = list.map((x, i) =>
      i === s
        ? assignment(source.introduce?.name as string, stmt.expression, stmt)
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
  const edit = reprintDeclaration(
    file,
    def,
    { ...updated, main: main ?? null },
    state.parser.printer,
    removed,
  );
  return [{ kind: "edit", path: file.path, edits: [edit] }];
}

/** Removes the argument that feeds an input port. */
export function disconnect(state: EditState, command: Disconnect): TextPatch[] {
  const { file, def, projection } = locateWorkflow(state, command.target);
  const node = nodeOf(projection, command.port, "inputs");
  const port = node.inputs.find((p) => p.id === command.port.port);
  if (node.kind === "emit" || node.kind === "output")
    throw invalid(
      `The value of ${node.label} can't be disconnected; change or delete it in the code.`,
    );
  if (node.kind === "chain" && command.port.port === "in")
    throw invalid(
      `${node.label} needs its input channel; connect another one instead.`,
    );
  if (!port?.argument)
    throw invalid(
      `${node.label} has nothing connected to ${command.port.port}.`,
    );
  if (!argumentOwner(def, port.argument))
    throw invalid(
      `The input of ${node.label} can't be disconnected from here.`,
    );
  const cleared = clearArgument(def, port.argument);
  const edit = reprintDeclaration(
    file,
    def,
    cleared.def,
    state.parser.printer,
    [cleared.removed],
  );
  return [{ kind: "edit", path: file.path, edits: [edit] }];
}
