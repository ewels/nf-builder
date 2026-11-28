import type {
  CreateProcess,
  CreateWorkflow,
  TextPatch,
} from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import {
  isIdentifier,
  moduleDirectory,
  relativeSource,
  subworkflowDirectory,
} from "../names";
import { includeOf } from "../nodes";
import { EditRefusal } from "../refusal";
import { includeInsertion } from "../splice";

const STATEMENT_KINDS = new Set([
  "Block",
  "ExpressionStatement",
  "VariableDeclaration",
  "Assignment",
  "If",
  "TryCatch",
  "Return",
  "Throw",
  "Assert",
  "EmptyStatement",
]);

type Kind = "process" | "workflow";

/** A new typed process in `modules/local/<name>/main.nf`, included from the caller (LA-12). It adds no call. */
export const createProcess = (
  state: EditState,
  command: CreateProcess,
): TextPatch[] => createDefinition(state, command, "process");

/** A new named workflow in `subworkflows/local/<name>/main.nf`, included from the caller (LA-12, F-301). It adds no call. */
export const createWorkflow = (
  state: EditState,
  command: CreateWorkflow,
): TextPatch[] => createDefinition(state, command, "workflow");

function createDefinition(
  state: EditState,
  command: CreateProcess | CreateWorkflow,
  kind: Kind,
): TextPatch[] {
  const { name, caller } = command;
  if (!isIdentifier(name))
    throw new EditRefusal(
      "invalid",
      `"${name}" isn't a valid ${kind} name. Use letters, digits and underscores, starting with a letter or underscore.`,
    );
  const file = state.model.file(caller)?.source;
  if (!file)
    throw new EditRefusal("not-found", `There is no file ${caller}.`, caller);
  if (
    file.language !== "nextflow" ||
    (file.status !== "modelled" && file.status !== "partial")
  )
    throw new EditRefusal(
      "invalid",
      `${caller} isn't a Nextflow script the builder can add an include to.`,
      caller,
    );
  if (file.ast?.body.some((i) => STATEMENT_KINDS.has(i.kind)))
    throw new EditRefusal(
      "invalid",
      `${caller} has statements outside a workflow block, and Nextflow doesn't allow an include next to them. Move them into a workflow first.`,
      caller,
    );
  const directory = kind === "process" ? moduleDirectory : subworkflowDirectory;
  const path = `${directory(name)}/main.nf`;
  if (state.model.paths().includes(path))
    throw new EditRefusal(
      "invalid",
      `${path} already exists. Pick another ${kind} name.`,
      path,
    );
  if (state.model.lookup(caller, name))
    throw new EditRefusal(
      "invalid",
      `${name} is already defined or included in ${caller}. Pick another ${kind} name.`,
      caller,
    );
  const include = includeOf(name, relativeSource(caller, path));
  return [
    { kind: "create", path, text: state.scaffold[kind](name) },
    {
      kind: "edit",
      path: caller,
      edits: [includeInsertion(file, include, state.parser.printer)],
    },
  ];
}
