import type { LintSpec, Outcome, RunSpec } from "./cases.ts";
import type { ExecResult } from "./nextflow.ts";

/** One entry of `errors` or `warnings`; the position keys are there when Nextflow printed them. */
export type LintMessage = {
  message: string;
  filename?: string;
  startLine?: number;
  startColumn?: number;
};
export type LintReport = { errors: LintMessage[]; warnings: LintMessage[] };

/** Finds the JSON object `nextflow lint -o json` prints (from the first line that is exactly "{"); null if there is none or it doesn't parse. */
export function parseLintJson(stdout: string): LintReport | null {
  const lines = stdout.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === "{");
  if (start < 0) return null;
  try {
    const value: unknown = JSON.parse(lines.slice(start).join("\n"));
    if (typeof value !== "object" || value === null) return null;
    const { errors, warnings } = value as Partial<LintReport>;
    return {
      errors: Array.isArray(errors) ? errors : [],
      warnings: Array.isArray(warnings) ? warnings : [],
    };
  } catch {
    return null;
  }
}

export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** What `nextflow lint -format -o json` prints that the format checks use: the summary counts and the errors with their positions. */
export type FormatReport = {
  summary: { errors: number; filesFormatted: number };
  errors: {
    filename: string;
    startLine: number;
    startColumn: number;
    message: string;
  }[];
};

/** Finds the JSON object `nextflow lint -format -o json` prints (as parseLintJson); null if there is none, it doesn't parse or it lacks a summary. */
export function parseFormatJson(stdout: string): FormatReport | null {
  const lines = stdout.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === "{");
  if (start < 0) return null;
  try {
    const value: unknown = JSON.parse(lines.slice(start).join("\n"));
    if (typeof value !== "object" || value === null) return null;
    const { summary, errors } = value as {
      summary?: { errors?: unknown; filesFormatted?: unknown };
      errors?: unknown;
    };
    if (
      typeof summary !== "object" ||
      summary === null ||
      typeof summary.errors !== "number" ||
      typeof summary.filesFormatted !== "number"
    )
      return null;
    return {
      summary: {
        errors: summary.errors,
        filesFormatted: summary.filesFormatted,
      },
      errors: Array.isArray(errors) ? (errors as FormatReport["errors"]) : [],
    };
  } catch {
    return null;
  }
}

export type CheckKind = "lint" | "run" | "format" | "fixed-point";
export type Evaluation = {
  actual: Outcome;
  matched: boolean;
  problems: string[];
  errors: string[];
  warnings: string[];
};

const mismatch = (
  expected: Outcome,
  actual: Outcome,
  result: ExecResult,
  detail?: string,
): string =>
  `expected ${expected}, got ${actual} (exit ${result.status ?? result.signal})${detail ? `; ${detail}` : ""}`;

const actualOf = (result: ExecResult): Outcome =>
  result.status === 0 ? "ok" : "error";

/** actual = status 0 ? ok : error. Matched when actual equals expect and every spec.errors text is a substring of some error message. */
export function evaluateLint(spec: LintSpec, result: ExecResult): Evaluation {
  const actual = actualOf(result);
  const report = parseLintJson(result.stdout);
  const errors = report?.errors.map((e) => e.message) ?? [];
  const warnings = report?.warnings.map((e) => e.message) ?? [];
  const problems: string[] = [];
  const quote = errors
    .slice(0, 3)
    .map((e) => `"${e}"`)
    .join(", ");
  if (actual !== spec.expect) {
    problems.push(
      mismatch(spec.expect, actual, result, quote && `first errors: ${quote}`),
    );
  } else if (spec.expect === "error") {
    if (report === null) problems.push("no JSON report in the lint output");
    for (const text of spec.errors) {
      if (!errors.some((e) => e.includes(text))) {
        problems.push(
          `no lint error contains "${text}"; actual errors: ${quote || "none"}`,
        );
      }
    }
  }
  if (spec.clean && warnings.length > 0) {
    const quoted = warnings
      .slice(0, 3)
      .map((w) => `"${w}"`)
      .join(", ");
    problems.push(
      `lint is not clean: ${warnings.length} warning(s), first ${quoted}`,
    );
  }
  return { actual, matched: problems.length === 0, problems, errors, warnings };
}

/** Matched when actual equals expect and every spec.output text is in stripAnsi(stdout + "\n" + stderr). */
export function evaluateRun(spec: RunSpec, result: ExecResult): Evaluation {
  const actual = actualOf(result);
  const text = stripAnsi(`${result.stdout}\n${result.stderr}`);
  const problems: string[] = [];
  if (actual !== spec.expect) {
    const first = text.split("\n").find((l) => /error/i.test(l));
    problems.push(
      mismatch(
        spec.expect,
        actual,
        result,
        first && `first error line: ${first.trim()}`,
      ),
    );
  } else {
    for (const needle of spec.output) {
      if (!text.includes(needle)) {
        problems.push(`output does not contain "${needle}"`);
      }
    }
  }
  return {
    actual,
    matched: problems.length === 0,
    problems,
    errors: [],
    warnings: [],
  };
}
