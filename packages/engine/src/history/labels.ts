// Labels for undo steps (F-209): British English, sentence case. Steps keep labels, not commands, because a
// ReplaceFileText command would duplicate a whole file.
import type { EditCommand } from "@nf-builder/lang-core";

export function commandLabel(command: EditCommand): string {
  switch (command.kind) {
    case "createProcess":
      return `Create process ${command.name}`;
    case "createWorkflow":
      return `Create workflow ${command.name}`;
    case "addCall":
      return `Add call to ${command.callee}`;
    case "connect":
      return "Connect";
    case "disconnect":
      return "Disconnect";
    case "deleteNode":
      return "Delete node";
    case "renameDeclaration":
      return `Rename ${command.name} to ${command.newName}`;
    case "replaceFileText":
      return `Edit ${command.path}`;
    case "createFile":
      return `Create ${command.path}`;
  }
}
