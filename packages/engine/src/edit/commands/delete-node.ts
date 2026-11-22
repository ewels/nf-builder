import type { AstNode, DeleteNode, TextPatch } from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { EditRefusal } from "../refusal";
import { reprintDeclaration } from "../splice";
import {
  argumentOwner,
  clearArgument,
  locateWorkflow,
  topLevelIndex,
} from "../workflow";

/** Removes a node's statement and the direct arguments it fed, or clears the argument a nested node is. */
export function deleteNode(state: EditState, command: DeleteNode): TextPatch[] {
  const { file, def, projection } = locateWorkflow(state, command.target);
  const node = projection.nodes.find((n) => n.id === command.node);
  if (!node)
    throw new EditRefusal("not-found", `There is no node ${command.node}.`);
  if (
    node.kind === "take" ||
    node.kind === "emit" ||
    node.kind === "params" ||
    node.kind === "output"
  )
    throw new EditRefusal(
      "invalid",
      `${node.label} is part of the workflow's interface and can't be deleted here.`,
    );
  const removed: AstNode[] = [];
  const s = topLevelIndex(def, node);
  let updated = def;
  if (s >= 0) {
    for (const edge of projection.edges) {
      if (edge.from.node !== node.id || !edge.direct) continue;
      const to = projection.nodes.find((n) => n.id === edge.to.node);
      if (!to || (to.kind !== "call" && to.kind !== "chain")) continue;
      if (to.kind === "chain" && edge.to.port === "in") continue;
      const argument = to.inputs.find((p) => p.id === edge.to.port)?.argument;
      if (!argument || !argumentOwner(updated, argument)) continue;
      const cleared = clearArgument(updated, argument);
      updated = cleared.def;
      removed.push(cleared.removed);
    }
    const items = updated.main?.items ?? [];
    removed.push(def.main?.items[s] as AstNode);
    updated = {
      ...updated,
      main: updated.main && {
        ...updated.main,
        items: items.filter((_, i) => i !== s),
      },
    };
  } else {
    if (!argumentOwner(def, node.range))
      throw new EditRefusal(
        "invalid",
        `${node.label} is nested too deeply to delete from the graph. Edit the code instead.`,
      );
    const cleared = clearArgument(def, node.range);
    updated = cleared.def;
    removed.push(cleared.removed);
  }
  const edit = reprintDeclaration(
    file,
    def,
    updated,
    state.parser.printer,
    removed,
  );
  return [{ kind: "edit", path: file.path, edits: [edit] }];
}
