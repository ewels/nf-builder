// AddTake and AddEmit (F-307, UX-51, AR-21): one new take or emit on a named workflow, through `reprintDeclaration`.
// Call sites are not edited; the projection gives each call the new port, and Nextflow reports a short argument list.
import {
  type AddEmit,
  type AddTake,
  type NamedOutput,
  NO_RANGE,
  type Section,
  type TextPatch,
  type TypedName,
  type TypeRef,
  type Wildcard,
  type WorkflowDef,
} from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { builtinNames, isIdentifier, namesInWorkflow } from "../names";
import { identifier, nullLiteral } from "../nodes";
import { EditRefusal } from "../refusal";
import { reprintDeclaration } from "../splice";
import { locateWorkflow } from "../workflow";

type Role = "take" | "emit";

const bare = (t: TypeRef | Wildcard): TypeRef | Wildcard =>
  t.kind === "Wildcard"
    ? { kind: "Wildcard", range: NO_RANGE }
    : {
        kind: "TypeRef",
        name: t.name,
        typeArguments: t.typeArguments.map(bare),
        nullable: t.nullable,
        range: NO_RANGE,
      };

/** The type `text` names, as a node without positions; null when it isn't a type a typed take accepts. */
function parseType(state: EditState, text: string): TypeRef | null {
  const t = text.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.]*(<[^\n;{}:]*>)?\??$/.test(t)) return null;
  const parsed = state.parser.parseScript(
    `nextflow.enable.types = true\n\nworkflow W {\n    take:\n    x: ${t}\n\n    main:\n    y = 1\n}\n`,
  );
  if (parsed.status !== "modelled" || parsed.problems.length > 0) return null;
  const def = parsed.ast.body.find((i) => i.kind === "Workflow");
  const type = def?.kind === "Workflow" ? def.takes?.items[0]?.type : null;
  return type ? (bare(type) as TypeRef) : null;
}

/** Checks the target and the name and type; returns what the command needs to build the new item. */
function check(
  state: EditState,
  command: AddTake | AddEmit,
  role: Role,
): { path: string; def: WorkflowDef; type: TypeRef | null } {
  const { file, def } = locateWorkflow(state, command.target);
  const refuse = (message: string) =>
    new EditRefusal("invalid", message, file.path);
  const where = def.name ? `Workflow ${def.name.name}` : "The entry workflow";
  if (def.name === null)
    throw refuse(
      role === "take"
        ? "The entry workflow has no take; use params."
        : "The entry workflow has no emit; publish outputs instead.",
    );
  const { name } = command;
  if (!isIdentifier(name))
    throw refuse(
      `"${name}" isn't a valid ${role} name. Use letters, digits and underscores, starting with a letter or underscore.`,
    );
  if (builtinNames(state.catalogue).has(name))
    throw refuse(
      `"${name}" is a built-in name in Nextflow. Pick another ${role} name.`,
    );
  const emitted = (def.emits?.items ?? []).flatMap((i) =>
    i.kind === "NamedOutput" ? [i.name.name] : [],
  );
  const taken =
    role === "take"
      ? namesInWorkflow(def).has(name) || emitted.includes(name)
      : emitted.includes(name);
  if (taken)
    throw refuse(
      `"${name}" is already used in ${where}. Pick another ${role} name.`,
    );
  let type: TypeRef | null = null;
  if (def.typed) {
    if (command.type === null || command.type.trim() === "")
      throw refuse(
        `${where} is typed, so the ${role} needs a type, for example Channel<Path>.`,
      );
    type = parseType(state, command.type);
    if (type === null)
      throw refuse(`"${command.type}" isn't a type Nextflow accepts here.`);
  } else if (command.type !== null && command.type.trim() !== "") {
    throw refuse(
      `${where} is a legacy workflow, so its ${role}s have no type.`,
    );
  }
  return { path: file.path, def, type };
}

function section<T>(
  existing: Section<T> | null,
  label: "take" | "emit",
  item: T,
): Section<T> {
  return existing
    ? { ...existing, items: [...existing.items, item] }
    : {
        kind: "Section",
        label,
        labelRange: null,
        items: [item],
        range: NO_RANGE,
      };
}

/** Appends `name: Type` (typed) or `name` (legacy) to the workflow's `take:`, creating the section when it has none. */
export function addTake(state: EditState, command: AddTake): TextPatch[] {
  const { path, def, type } = check(state, command, "take");
  if (def.main === null && def.emits === null)
    throw new EditRefusal(
      "invalid",
      `Add a step or an emit to ${def.name?.name} first; Nextflow needs one after take.`,
      path,
    );
  const item: TypedName = {
    kind: "TypedName",
    name: identifier(command.name),
    type,
    range: NO_RANGE,
  };
  return patch(state, command, def, {
    ...def,
    takes: section(def.takes, "take", item),
  });
}

/**
 * Appends `name: Type = null` (typed) or `name = null` (legacy) to the workflow's `emit:`, creating the section when it
 * has none. Refused when the workflow has one emit: its call sites read it directly, and a second one would break them.
 */
export function addEmit(state: EditState, command: AddEmit): TextPatch[] {
  const { def, type } = check(state, command, "emit");
  if (def.emits?.items.length === 1)
    throw new EditRefusal(
      "invalid",
      `${def.name?.name}'s only emit is read directly at its call sites; adding a second one would break them.`,
      command.target.path,
    );
  const item: NamedOutput = {
    kind: "NamedOutput",
    name: identifier(command.name),
    type,
    value: nullLiteral(),
    range: NO_RANGE,
  };
  return patch(state, command, def, {
    ...def,
    emits: section(def.emits, "emit", item),
  });
}

function patch(
  state: EditState,
  command: AddTake | AddEmit,
  def: WorkflowDef,
  updated: WorkflowDef,
): TextPatch[] {
  const { file } = locateWorkflow(state, command.target);
  const edit = reprintDeclaration(file, def, updated, state.parser.printer);
  return [{ kind: "edit", path: file.path, edits: [edit] }];
}
