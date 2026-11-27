// What opening a file from the tree does (UX-20, UX-52, F-210). Pure.
import type { WorkflowRef } from "@nf-builder/lang-core";
import { readOnlyReason } from "./paths";
import type { OpenTarget } from "./types";

/** A script with a workflow opens its canvas (the entry workflow, else the first); anything else opens as a file. */
export function openTarget(
  path: string,
  workflows: readonly WorkflowRef[],
): OpenTarget {
  const here = workflows.filter((w) => w.path === path);
  const workflow = here.find((w) => w.name === null) ?? here[0];
  if (workflow) return { kind: "workflow", path, workflow: workflow.name };
  return { kind: "file", path, readOnly: readOnlyReason(path) };
}
