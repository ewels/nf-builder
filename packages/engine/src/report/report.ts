// The import report (F-401, UX-61): what a project's parse produced, as plain data. Pure: it reads the model, the
// projector's workflow list and the diagnostics, and changes nothing.
import type {
  DeclarationHead,
  Diagnostic,
  WorkflowRef,
} from "@nf-builder/lang-core";
import {
  countDiagnostics,
  type DiagnosticCounts,
} from "../diagnostics/diagnose";
import type { ProjectModel } from "../model/project";

export interface StyleCounts {
  readonly typed: number;
  readonly legacy: number;
}

export interface ParseFailure {
  readonly path: string;
  readonly status: "partial" | "verbatim";
  readonly problems: number;
  /** The declarations kept as text; empty when the whole file is verbatim. */
  readonly unparsed: readonly DeclarationHead[];
}

export interface ProjectReport {
  readonly revision: number;
  readonly files: number;
  readonly parseFailures: readonly ParseFailure[];
  readonly processes: StyleCounts;
  readonly workflows: StyleCounts;
  readonly diagnostics: DiagnosticCounts;
}

export function projectReport(
  model: ProjectModel,
  workflows: readonly WorkflowRef[],
  diagnostics: readonly Diagnostic[],
): Omit<ProjectReport, "revision"> {
  const paths = model.paths();
  const parseFailures: ParseFailure[] = [];
  const processes = { typed: 0, legacy: 0 };
  for (const path of paths) {
    const source = model.file(path)?.source;
    if (source === undefined) continue;
    const ast = source.language === "nextflow" ? source.ast : null;
    if (source.status === "partial" || source.status === "verbatim") {
      const items =
        source.language === "nextflow"
          ? (source.ast?.body ?? [])
          : source.language === "config"
            ? (source.ast?.statements ?? [])
            : [];
      parseFailures.push({
        path,
        status: source.status,
        problems: source.problems.length,
        unparsed: items.flatMap((item) =>
          item.kind === "Unparsed" && item.head !== null ? [item.head] : [],
        ),
      });
    }
    for (const item of ast?.body ?? [])
      if (item.kind === "Process")
        processes[item.typed ? "typed" : "legacy"] += 1;
  }
  const styles = { typed: 0, legacy: 0 };
  for (const w of workflows)
    if (w.modelled) styles[w.typed ? "typed" : "legacy"] += 1;
  return {
    files: paths.length,
    parseFailures: parseFailures.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
    processes,
    workflows: styles,
    diagnostics: countDiagnostics(diagnostics),
  };
}

/** Legacy over all modelled processes and workflows. */
export function legacyShare(
  r: Pick<ProjectReport, "processes" | "workflows">,
): {
  legacy: number;
  total: number;
} {
  const legacy = r.processes.legacy + r.workflows.legacy;
  return { legacy, total: legacy + r.processes.typed + r.workflows.typed };
}
