// The QA-03 and QA-04 benchmark report (F-113): measurements from e2e/bench/engine.bench.ts against the time budgets in
// scripts/budgets.json. Reported, not gated (ADR 0030): nothing here fails on a breach; F-702 gates QA-03.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Budget, readBudget } from "./check-bundle-budget.ts";
import { REPO_ROOT } from "./check-common.ts";

const REPORTS_DIR = join(REPO_ROOT, ".cache/reports");

export const readTimeBudget = (id: "QA-03" | "QA-04"): Budget<"maxMs"> =>
  readBudget(id, undefined, "maxMs");

/** Nearest rank: the smallest value with at least p% of the values at or below it. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("percentile of no values");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

export interface BenchResult {
  browser: string;
  cpuThrottle: number;
  open: {
    files: number;
    coldMs: number;
    warmMs: number;
    progressEvents: number;
    maxProgressGapMs: number;
    maxFrameGapMs: number;
  };
  edits: readonly { kind: string; ms: number }[];
}

export interface EditStats {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface BenchRow {
  id: string;
  description: string;
  measured: number;
  limit: number;
  within: boolean;
}

export interface BenchReport {
  result: BenchResult;
  edits: { overall: EditStats; perKind: Record<string, EditStats> };
  rows: BenchRow[];
}

const stats = (values: readonly number[]): EditStats => ({
  count: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: Math.max(...values),
});

const row = (id: "QA-03" | "QA-04", measured: number): BenchRow => {
  const { description, maxMs } = readTimeBudget(id);
  return { id, description, measured, limit: maxMs, within: measured <= maxMs };
};

export function benchReport(result: BenchResult): BenchReport {
  const kinds = [...new Set(result.edits.map((e) => e.kind))].sort();
  const perKind: Record<string, EditStats> = {};
  for (const kind of kinds)
    perKind[kind] = stats(
      result.edits.filter((e) => e.kind === kind).map((e) => e.ms),
    );
  const overall = stats(result.edits.map((e) => e.ms));
  return {
    result,
    edits: { overall, perKind },
    rows: [row("QA-03", result.open.coldMs), row("QA-04", overall.p95)],
  };
}

const ms = (n: number) => `${Math.round(n)} ms`;

export function benchMarkdown(report: BenchReport): string {
  const { result, edits, rows } = report;
  const lines = [
    "## Engine benchmark (QA-03, QA-04)",
    "",
    "Both budgets are reported, not gated (ADR 0030); worker timings unthrottled (Chromium can't throttle workers).",
    "",
    "| Budget | Measured | Limit | Result |",
    "|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${ms(r.measured)} | ${ms(r.limit)} | ${r.within ? "within" : "over"} |`,
    ),
    "",
    `${rows.map((r) => `${r.id}: ${r.description}`).join("; ")}.`,
    "",
    `Browser ${result.browser}, page CPU throttle ${result.cpuThrottle}x (it does not reach the worker).`,
    "",
    "| Open | Value |",
    "|---|---|",
    `| Files | ${result.open.files} |`,
    `| Cold open | ${ms(result.open.coldMs)} |`,
    `| Warm open | ${ms(result.open.warmMs)} |`,
    `| Progress events | ${result.open.progressEvents} |`,
    `| Longest gap between progress events | ${ms(result.open.maxProgressGapMs)} |`,
    `| Longest main-thread frame gap | ${ms(result.open.maxFrameGapMs)} |`,
    "",
    "| Edit (apply and project) | Samples | p50 | p95 | Max |",
    "|---|---|---|---|---|",
    ...[["all", edits.overall] as const, ...Object.entries(edits.perKind)].map(
      ([kind, s]) =>
        `| ${kind} | ${s.count} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.max)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

/** Writes bench.json and bench.md, and appends the markdown to the GitHub step summary when there is one. */
export function writeBenchReport(
  report: BenchReport,
  dir: string = REPORTS_DIR,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "bench.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const markdown = benchMarkdown(report);
  writeFileSync(join(dir, "bench.md"), markdown);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}
