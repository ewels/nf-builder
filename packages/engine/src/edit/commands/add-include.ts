import type { AddInclude, TextPatch } from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { isIdentifier, resolveSource } from "../names";
import { includeOf } from "../nodes";
import { EditRefusal } from "../refusal";
import { includeInsertion } from "../splice";
import { includableScript } from "./create-definition";

/**
 * Adds `include { name as alias } from 'source'` to the caller as a statement of its own, after the last include (F-310,
 * AR-21). Refuses a name or alias the caller already binds and a source that isn't a file of the project.
 */
export function addInclude(state: EditState, command: AddInclude): TextPatch[] {
  const { caller, name, alias, source } = command;
  const file = includableScript(state, caller);
  for (const id of alias === null ? [name] : [name, alias])
    if (!isIdentifier(id))
      throw new EditRefusal(
        "invalid",
        `"${id}" isn't a valid name. Use letters, digits and underscores, starting with a letter or underscore.`,
        caller,
      );
  const bound = alias ?? name;
  if (state.model.lookup(caller, bound))
    throw new EditRefusal(
      "invalid",
      `${bound} is already defined or included in ${caller}. Pick another name.`,
      caller,
    );
  const path = resolveSource(caller, source);
  if (path === null)
    throw new EditRefusal(
      "invalid",
      `${source} points outside the project, so it can't be included.`,
      caller,
    );
  if (!state.model.paths().includes(path))
    throw new EditRefusal(
      "invalid",
      `There is no file ${path} to include ${name} from.`,
      caller,
    );
  const include = includeOf(name, source, alias);
  return [
    {
      kind: "edit",
      path: caller,
      edits: [includeInsertion(file, include, state.parser.printer)],
    },
  ];
}
