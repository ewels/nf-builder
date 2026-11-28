import type { CreateFile, TextPatch } from "@nf-builder/lang-core";
import { newPathProblem } from "../../files/paths";
import type { EditState } from "../apply";
import { EditRefusal } from "../refusal";

/** A file, empty unless the command has text (UX-16, F-310); a new folder is its `.gitkeep`. The inverse deletes it. */
export function createFile(state: EditState, command: CreateFile): TextPatch[] {
  const problem = newPathProblem(command.path, state.model.tree);
  if (problem !== null) throw new EditRefusal("invalid", problem, command.path);
  return [{ kind: "create", path: command.path, text: command.text ?? "" }];
}
