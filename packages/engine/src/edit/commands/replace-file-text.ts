import type { ReplaceFileText, TextPatch } from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { diffText } from "../patches";
import { EditRefusal } from "../refusal";

/** One edit trimmed to the changed text; an unchanged text gives no patch. */
export function replaceFileText(
  state: EditState,
  command: ReplaceFileText,
): TextPatch[] {
  const file = state.model.file(command.path);
  if (!file)
    throw new EditRefusal(
      "not-found",
      `There is no file ${command.path} to replace.`,
      command.path,
    );
  const edit = diffText(file.source.text, command.text);
  return edit ? [{ kind: "edit", path: command.path, edits: [edit] }] : [];
}
