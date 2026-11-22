import type { CreateProcess, TextPatch } from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { isIdentifier, moduleDirectory, relativeSource } from "../names";
import { includeOf } from "../nodes";
import { EditRefusal } from "../refusal";
import { includeInsertion } from "../splice";

/** A new typed process in `modules/local/<name>/main.nf`, included from the caller (LA-12). It adds no call. */
export function createProcess(
  state: EditState,
  command: CreateProcess,
): TextPatch[] {
  const { name, caller } = command;
  if (!isIdentifier(name))
    throw new EditRefusal(
      "invalid",
      `"${name}" isn't a valid process name. Use letters, digits and underscores, starting with a letter or underscore.`,
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
  const path = `${moduleDirectory(name)}/main.nf`;
  if (state.model.paths().includes(path))
    throw new EditRefusal(
      "invalid",
      `${path} already exists. Pick another process name.`,
      path,
    );
  if (state.model.lookup(caller, name))
    throw new EditRefusal(
      "invalid",
      `${name} is already defined or included in ${caller}. Pick another process name.`,
      caller,
    );
  const include = includeOf(name, relativeSource(caller, path));
  return [
    { kind: "create", path, text: state.scaffold.process(name) },
    {
      kind: "edit",
      path: caller,
      edits: [includeInsertion(file, include, state.parser.printer)],
    },
  ];
}
