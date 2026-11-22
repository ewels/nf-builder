// The diagnoser (AR-05, F-112): parse problems, model diagnostics and the pack's rules, per file, sorted. It never throws.
import type {
  Catalogue,
  Diagnostic,
  LintContext,
  PackLints,
} from "@nf-builder/lang-core";
import type { ProjectModel } from "../model/project";
import type { Projector } from "../projection/project";
import { lintContext } from "./context";
import { problemRange } from "./ranges";

export interface DiagnoserOptions {
  model: ProjectModel;
  projector: Projector;
  catalogue: Catalogue;
  lints: PackLints;
}

export interface Diagnoser {
  /** The diagnostics of one file, sorted; none for an unknown path. */
  file(path: string): readonly Diagnostic[];
  /** Every file's diagnostics, sorted. */
  all(): readonly Diagnostic[];
}

export interface DiagnosticCounts {
  errors: number;
  warnings: number;
  suggestions: number;
}

export function countDiagnostics(
  list: readonly Diagnostic[],
): DiagnosticCounts {
  const counts = { errors: 0, warnings: 0, suggestions: 0 };
  for (const d of list) {
    if (d.severity === "error") counts.errors++;
    else if (d.severity === "warning") counts.warnings++;
    else counts.suggestions++;
  }
  return counts;
}

/** By path, then range start, then code. */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.range.start !== b.range.start) return a.range.start - b.range.start;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

const INTERNAL = "internal";

/** A snapshot of `model`, memoised per file like the projector; F-113 replaces it after a change. */
export function createDiagnoser(options: DiagnoserOptions): Diagnoser {
  const { model, projector, catalogue, lints } = options;
  const severities = new Map(lints.codes.map((c) => [c.code, c.severity]));
  const memo = new Map<string, readonly Diagnostic[]>();
  /** The pack's advice appended; the raw message if the pack throws. */
  const advise = (code: string, message: string): string => {
    try {
      return lints.advise(code, message);
    } catch {
      return message;
    }
  };

  function compute(path: string): Diagnostic[] {
    const file = model.file(path);
    if (!file) return [];
    const { source } = file;
    const out: Diagnostic[] = [];
    const internal = (message: string, range: Diagnostic["range"]) =>
      out.push({
        path,
        range,
        severity: "warning",
        message: advise(INTERNAL, message),
        code: INTERNAL,
      });

    for (const problem of source.problems) {
      const range = problemRange(source.text, problem);
      if (problem.source === "internal") internal(problem.message, range);
      else
        out.push({
          path,
          range,
          severity: severities.get("syntax") ?? "error",
          message: advise("syntax", problem.message),
          code: "syntax",
        });
    }
    for (const d of file.diagnostics)
      out.push({ ...d, message: advise(d.code, d.message) });

    let context: LintContext | null = null;
    try {
      context = lintContext({ model, projector, catalogue, path });
    } catch (error) {
      internal(`Lint context failed: ${errorText(error)}`, EMPTY);
    }
    if (context)
      for (const rule of lints.rules)
        try {
          for (const f of rule.check(context))
            out.push({
              path,
              range: f.range,
              severity: severities.get(rule.code) ?? "warning",
              message: f.message,
              code: rule.code,
              ...(f.fix
                ? { fix: { title: f.fix.title, path, edits: f.fix.edits } }
                : {}),
            });
        } catch (error) {
          internal(
            `Rule \`${rule.code}\` failed: ${errorText(error)}`,
            context.file.ast?.range ?? EMPTY,
          );
        }
    return out.sort(compareDiagnostics);
  }

  const file = (path: string): readonly Diagnostic[] => {
    let list = memo.get(path);
    if (!list) {
      list = compute(path);
      memo.set(path, list);
    }
    return list;
  };
  return {
    file,
    all: () => model.paths().flatMap(file),
  };
}

const EMPTY = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
