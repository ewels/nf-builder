// Finding the workflow a command targets (F-111).
import type {
  ScriptSourceFile,
  WorkflowDef,
  WorkflowTarget,
} from "@nf-builder/lang-core";
import type { EditState } from "./apply";
import { EditRefusal } from "./refusal";

/** The script and the named (or entry) workflow of `target`; refuses what can't be edited. */
export function locateWorkflow(
  state: EditState,
  target: WorkflowTarget,
): { file: ScriptSourceFile; def: WorkflowDef } {
  const file = state.model.file(target.path)?.source;
  if (!file)
    throw new EditRefusal(
      "not-found",
      `There is no file ${target.path}.`,
      target.path,
    );
  if (file.language !== "nextflow" || file.ast === null)
    throw new EditRefusal(
      "invalid",
      `${target.path} has no parsed Nextflow code to edit.`,
      target.path,
    );
  const label =
    target.workflow === null
      ? "The entry workflow"
      : `Workflow ${target.workflow}`;
  for (const item of file.ast.body) {
    if (
      item.kind === "Workflow" &&
      (item.name?.name ?? null) === target.workflow
    )
      return { file, def: item };
    if (
      item.kind === "Unparsed" &&
      item.head?.keyword === "workflow" &&
      item.head.name === target.workflow
    )
      throw new EditRefusal(
        "invalid",
        `${label} in ${target.path} has code that doesn't parse. Fix it in the Code tab first.`,
        target.path,
      );
  }
  throw new EditRefusal(
    "not-found",
    target.workflow === null &&
      file.ast.body.some(
        (i) =>
          i.kind !== "FeatureFlag" &&
          i.kind !== "Include" &&
          i.kind !== "Process" &&
          i.kind !== "Workflow",
      )
      ? `${target.path} has statements outside a workflow block; the builder can't edit them.`
      : `${label} is not defined in ${target.path}.`,
    target.path,
  );
}
