import type { DeleteNode, TextPatch } from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { deleteNodes } from "./delete-nodes";

/** Removes a node's statement and the direct arguments it fed, or clears the argument a nested node is. */
export const deleteNode = (
  state: EditState,
  command: DeleteNode,
): TextPatch[] =>
  deleteNodes(state, {
    kind: "deleteNodes",
    target: command.target,
    nodes: [command.node],
  });
