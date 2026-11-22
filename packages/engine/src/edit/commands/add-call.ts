import {
  type AddCall,
  type MethodCall,
  NO_RANGE,
  type ScriptNode,
  type Section,
  type Statement,
  type TextPatch,
  type WorkflowDef,
  walk,
} from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { call, expressionStatement } from "../nodes";
import { EditRefusal } from "../refusal";
import { reprintDeclaration } from "../splice";
import { locateWorkflow, mentionedNames } from "../workflow";

const CALLABLE = new Set(["Process", "Workflow", "Agent"]);
const CALLABLE_HEADS = new Set(["process", "workflow", "agent"]);

const callable = (d: ScriptNode): boolean =>
  CALLABLE.has(d.kind) ||
  (d.kind === "Unparsed" && CALLABLE_HEADS.has(d.head?.keyword ?? ""));

const isProcess = (d: ScriptNode | null): boolean =>
  d !== null &&
  (d.kind === "Process" ||
    (d.kind === "Unparsed" && d.head?.keyword === "process"));

/** Whether the workflow already calls `name` (a call, a pipe or a mention of its outputs). */
function callsAlready(def: WorkflowDef, name: string): boolean {
  if (mentionedNames(def).has(name)) return true;
  let found = false;
  walk(def, (node) => {
    if (node.kind !== "MethodCall") return undefined;
    const c = node as MethodCall;
    if (
      c.receiver === null &&
      c.method.kind === "Identifier" &&
      c.method.name === name
    )
      found = true;
    return undefined;
  });
  return found;
}

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
  const target =
    binding.kind === "declaration"
      ? binding.declaration
      : binding.entry.declaration;
  // Nextflow fails at run time when a process is called twice in one workflow; lint doesn't (oracle case f111-addcall-twice)
  if (isProcess(target) && callsAlready(def, callee))
    throw new EditRefusal(
      "invalid",
      `\`${callee}\` is already called in ${def.name ? `workflow \`${def.name.name}\`` : "the entry workflow"}; Nextflow can call a process only once per workflow. Include it again under another name (\`include { ${callee} as ${callee}_2 }\`) to call it twice.`,
      file.path,
    );
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
