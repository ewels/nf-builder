import {
  type AddCall,
  NO_RANGE,
  type ScriptNode,
  type Section,
  type Statement,
  type TextPatch,
} from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { call, expressionStatement } from "../nodes";
import { EditRefusal } from "../refusal";
import { reprintDeclaration } from "../splice";
import { locateWorkflow } from "../workflow";

const CALLABLE = new Set(["Process", "Workflow", "Agent"]);
const CALLABLE_HEADS = new Set(["process", "workflow", "agent"]);

const callable = (d: ScriptNode): boolean =>
  CALLABLE.has(d.kind) ||
  (d.kind === "Unparsed" && CALLABLE_HEADS.has(d.head?.keyword ?? ""));

/** Appends a bare `CALLEE()` to the target workflow's `main`, creating the section when it has none. */
export function addCall(state: EditState, command: AddCall): TextPatch[] {
  const { file, def } = locateWorkflow(state, command.target);
  const { callee } = command;
  const binding = state.model.lookup(file.path, callee);
  const refuse = (why: string) =>
    new EditRefusal(
      "invalid",
      `${callee} can't be called here: ${why}.`,
      file.path,
    );
  if (!binding) throw refuse("it isn't defined or included in this file");
  if (binding.kind === "declaration") {
    const d = binding.declaration;
    if (!callable(d)) throw refuse("it isn't a process, workflow or agent");
    if (d === def) throw refuse("a workflow can't call itself");
  } else {
    if (binding.include.target.kind === "plugin")
      throw refuse("it comes from a plugin");
    if (binding.entry.pipeline) throw refuse("it is a pipeline");
    const d = binding.entry.declaration;
    if (d !== null && !callable(d))
      throw refuse("it isn't a process, workflow or agent");
  }
  const statement: Statement = expressionStatement(call(callee, []));
  const main: Section<Statement> = def.main
    ? { ...def.main, items: [...def.main.items, statement] }
    : {
        kind: "Section",
        label: "main",
        labelRange: null,
        items: [statement],
        range: NO_RANGE,
      };
  const edit = reprintDeclaration(
    file,
    def,
    { ...def, main },
    state.parser.printer,
  );
  return [{ kind: "edit", path: file.path, edits: [edit] }];
}
