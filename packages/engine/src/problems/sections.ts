import type { Diagnostic } from "@nf-builder/lang-core";
import { compareDiagnostics, countDiagnostics } from "../diagnostics/diagnose";
import type {
  ProblemCounts,
  ProblemGroup,
  ProblemSections,
  ProblemsView,
} from "./types";

/** Errors and warnings are problems; suggestions have their own tab. */
export const problemsView = (d: Diagnostic): ProblemsView =>
  d.severity === "suggestion" ? "suggestions" : "problems";

export function problemCounts(list: readonly Diagnostic[]): ProblemCounts {
  const c = countDiagnostics(list);
  return { ...c, problems: c.errors + c.warnings };
}

/** The key that tells diagnostics apart (the same as F-206's de-duplication key); survives structuredClone. */
export const problemKey = (d: Diagnostic): string =>
  `${d.path}\0${d.range.start}\0${d.range.end}\0${d.code}\0${d.message}`;

const severityRank = (d: Diagnostic) => (d.severity === "error" ? 0 : 1);

function group(
  list: readonly Diagnostic[],
  compare: (a: Diagnostic, b: Diagnostic) => number,
): ProblemGroup[] {
  const byPath = new Map<string, Diagnostic[]>();
  for (const d of list) {
    const items = byPath.get(d.path);
    if (items) items.push(d);
    else byPath.set(d.path, [d]);
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, diagnostics]) => ({
      path,
      diagnostics: diagnostics.sort(compare),
    }));
}

/** Two tabs of file groups in path order: Problems (errors before warnings) and Suggestions, each in source order. */
export function problemSections(list: readonly Diagnostic[]): ProblemSections {
  return {
    problems: group(
      list.filter((d) => problemsView(d) === "problems"),
      (a, b) => severityRank(a) - severityRank(b) || compareDiagnostics(a, b),
    ),
    suggestions: group(
      list.filter((d) => problemsView(d) === "suggestions"),
      compareDiagnostics,
    ),
    counts: problemCounts(list),
  };
}
