import type {
  AstNode,
  DeleteNodes,
  GraphNode,
  Range,
  TextPatch,
} from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { EditRefusal } from "../refusal";
import { reprintDeclaration } from "../splice";
import { callableIn, dropUnreadAssignments } from "../unread";
import {
  clearArgument,
  graphNode,
  locateWorkflow,
  topLevelIndex,
  topStatement,
} from "../workflow";

const key = (r: Range) => `${r.start}:${r.end}`;

/**
 * Removes the statements of several nodes in one reprint (F-310, UX-26, AR-23) and clears the direct arguments they fed
 * (ADR 0039), apart from those of nodes that go too; a nested node is cleared from the argument it is. An assignment
 * that nothing reads afterwards becomes a bare call (ADR 0064). Refuses as a single delete does, naming the first node.
 */
export function deleteNodes(
  state: EditState,
  command: DeleteNodes,
): TextPatch[] {
  const { file, def, projection } = locateWorkflow(state, command.target);
  if (command.nodes.length === 0)
    throw new EditRefusal("invalid", "There is nothing to delete.");
  const nodes: GraphNode[] = [...new Set(command.nodes)].map((id) =>
    graphNode(projection, id),
  );
  for (const node of nodes)
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
  const ids = new Set(nodes.map((n) => n.id));
  // top-level statements that go; a nested node inside one of them goes with it
  const topIndex = new Map(nodes.map((n) => [n.id, topLevelIndex(def, n)]));
  const gone = new Set([...topIndex.values()].filter((s) => s >= 0));
  const removed: AstNode[] = [];
  const cleared = new Set<string>();
  let updated = def;
  const clear = (argument: Range): boolean => {
    if (cleared.has(key(argument))) return true;
    const result = clearArgument(updated, argument);
    if (!result) return false;
    updated = result.def;
    removed.push(result.removed);
    cleared.add(key(argument));
    return true;
  };
  for (const node of nodes) {
    if ((topIndex.get(node.id) as number) >= 0) {
      for (const edge of projection.edges) {
        if (edge.from.node !== node.id || !edge.direct || ids.has(edge.to.node))
          continue;
        const to = projection.nodes.find((n) => n.id === edge.to.node);
        if (!to || (to.kind !== "call" && to.kind !== "chain")) continue;
        if (to.kind === "chain" && edge.to.port === "in") continue;
        if (gone.has(topStatement(def, to.range))) continue;
        const argument = to.inputs.find((p) => p.id === edge.to.port)?.argument;
        if (argument) clear(argument);
      }
    } else if (!gone.has(topStatement(def, node.range)) && !clear(node.range)) {
      throw new EditRefusal(
        "invalid",
        `${node.label} is nested too deeply to delete from the graph. Edit the code instead.`,
      );
    }
  }
  const items = (updated.main?.items ?? []).filter((_, i) => !gone.has(i));
  for (const s of gone) removed.push(def.main?.items[s] as AstNode);
  if (gone.size > 0) {
    if (items.length === 0) {
      // Nextflow rejects an empty `main:`, and `take:` needs a `main:` or an `emit:` after it (checked with nextflow lint)
      const needsMain =
        (updated.takes !== null && updated.emits === null) ||
        updated.publishers !== null ||
        updated.onComplete !== null ||
        updated.onError !== null;
      if (needsMain)
        throw new EditRefusal(
          "invalid",
          `${(nodes[0] as GraphNode).label} is the only statement in the workflow's main section, and the workflow needs one. Edit the code instead.`,
          file.path,
        );
      updated = { ...updated, main: null };
    } else {
      updated = {
        ...updated,
        main: updated.main && { ...updated.main, items },
      };
    }
  }
  updated = dropUnreadAssignments(def, updated, callableIn(state, file.path));
  const edit = reprintDeclaration(
    file,
    def,
    updated,
    state.parser.printer,
    removed,
  );
  return [{ kind: "edit", path: file.path, edits: [edit] }];
}
