// The suggestions that lie inside one workflow (F-405, LA-35, LA-36). Pure.

import type { Diagnostic, WorkflowRef } from "@nf-builder/lang-core";
import { compareDiagnostics } from "../diagnostics/diagnose";
import { rangeContains } from "./node-range";

/** The workflow's own suggestions in source order; the findings of the components it calls are not counted. */
export function workflowSuggestions(
  workflow: WorkflowRef,
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return diagnostics
    .filter(
      (d) =>
        d.severity === "suggestion" &&
        d.path === workflow.path &&
        rangeContains(workflow.range, d.range),
    )
    .sort(compareDiagnostics);
}
