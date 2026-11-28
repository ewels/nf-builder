// Labels for undo steps (F-209): British English, sentence case. Steps keep labels, not commands, because a
// ReplaceFileText command would duplicate a whole file.
import type { ConfigContext, EditCommand } from "@nf-builder/lang-core";

/** ` for withLabel: big_mem in profile test`: where a config command acts. */
function where(context: ConfigContext): string {
  const selector = context.selector
    ? ` for ${context.selector.kind}: ${context.selector.pattern}`
    : "";
  return `${selector}${context.profile === null ? "" : ` in profile ${context.profile}`}`;
}

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
    case "setConfigOption":
      return `Set ${command.option.join(".")}${where(command.context)}`;
    case "removeConfigOption":
      return `Remove ${command.option.join(".")}${where(command.context)}`;
    case "addConfigBlock":
      if (command.scope.length > 0)
        return `Add ${command.scope.join(".")}${where(command.context)}`;
      return command.context.selector
        ? `Add selector ${command.context.selector.kind}: ${command.context.selector.pattern}${where({ ...command.context, selector: null })}`
        : `Add profile ${command.context.profile}`;
    case "addConfigPlugin":
      return `Add plugin ${command.id}`;
    case "removeConfigPlugin":
      return `Remove plugin ${command.id}`;
    case "createFile":
      return `Create ${command.path}`;
    case "updateDeclaration":
    case "replaceDeclaration":
      return `Edit process ${command.name}`;
    case "moveFile":
      return `Move ${command.path} to ${command.newPath}`;
  }
}
