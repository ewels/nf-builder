import { readdirSync, readFileSync } from "node:fs";

/** ADR 0010; the definitions are in the spike report. */
export const THRESHOLDS = {
  coldStartMs: 10_000,
  memoryMb: 500,
  diagnosticsMs: 2_000,
} as const;

export type RunKind = "cold" | "warm";

export type RunMetrics = {
  variant: string;
  kind: RunKind;
  /** Worker creation to the initialize response. */
  coldStartMs: number;
  firstDiagnosticsMs: number;
  editDiagnosticsMs: number[];
  baselineRssMb: number | null;
  peakRssMb: number | null;
  longTaskMaxMs: number;
  requests: { cdn: number; app: number };
  bytes: { cdn: number; jar: number };
};

export type Stat = { median: number; max: number };
export type Verdict = { pass: boolean; misses: string[] };

export type VariantSummary = {
  variant: string;
  coldRuns: number;
  warmRuns: number;
  coldStartMs: Stat;
  warmStartMs: Stat;
  /** Peak renderer RSS minus its RSS before the worker started. */
  memoryMb: Stat;
  peakRssMb: Stat;
  firstDiagnosticsMs: Stat;
  editDiagnosticsMs: Stat;
  verdict: Verdict;
};

export type Environment = {
  date: string;
  chromium: string;
  cpu: string;
  cores: number;
  memoryGb: number;
  proxy: boolean;
  loaderSha256: string;
};

export type ReferenceResult = {
  initializeMs: number;
  firstDiagnosticsMs: number;
  editDiagnosticsMs: number[];
};

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of no values");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[mid - 1] as number) + upper) / 2;
}

function stat(values: readonly number[]): Stat {
  return { median: median(values), max: Math.max(...values) };
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function thresholdSeconds(ms: number): string {
  return `${ms / 1000} s`;
}

export function verdict(summary: Omit<VariantSummary, "verdict">): Verdict {
  const misses: string[] = [];
  if (summary.coldStartMs.median >= THRESHOLDS.coldStartMs)
    misses.push(
      `cold start ${seconds(summary.coldStartMs.median)} (threshold ${thresholdSeconds(THRESHOLDS.coldStartMs)})`,
    );
  if (summary.memoryMb.median >= THRESHOLDS.memoryMb)
    misses.push(
      `memory ${Math.round(summary.memoryMb.median)} MB (threshold ${THRESHOLDS.memoryMb} MB)`,
    );
  if (summary.editDiagnosticsMs.median >= THRESHOLDS.diagnosticsMs)
    misses.push(
      `diagnostics ${seconds(summary.editDiagnosticsMs.median)} (threshold ${thresholdSeconds(THRESHOLDS.diagnosticsMs)})`,
    );
  return { pass: misses.length === 0, misses };
}

export function summarise(runs: readonly RunMetrics[]): VariantSummary[] {
  const variants = [...new Set(runs.map((r) => r.variant))];
  return variants.map((variant) => {
    const mine = runs.filter((r) => r.variant === variant);
    const cold = mine.filter((r) => r.kind === "cold");
    const warm = mine.filter((r) => r.kind === "warm");
    const withMemory = cold.filter(
      (r) => r.baselineRssMb !== null && r.peakRssMb !== null,
    );
    const partial = {
      variant,
      coldRuns: cold.length,
      warmRuns: warm.length,
      coldStartMs: stat(cold.map((r) => r.coldStartMs)),
      warmStartMs: stat(warm.map((r) => r.coldStartMs)),
      memoryMb: stat(
        withMemory.map(
          (r) => (r.peakRssMb as number) - (r.baselineRssMb as number),
        ),
      ),
      peakRssMb: stat(withMemory.map((r) => r.peakRssMb as number)),
      firstDiagnosticsMs: stat(mine.map((r) => r.firstDiagnosticsMs)),
      editDiagnosticsMs: stat(
        mine
          .filter((r) => r.editDiagnosticsMs.length > 0)
          .map((r) => median(r.editDiagnosticsMs)),
      ),
    };
    return { ...partial, verdict: verdict(partial) };
  });
}

function cell(value: string, pass: boolean): string {
  return `${value} (${pass ? "pass" : "miss"})`;
}

export function toMarkdown(
  summaries: readonly VariantSummary[],
  environment: Environment,
  reference?: ReferenceResult,
): string {
  const lines = [
    "# Spike S3 results",
    "",
    `- Date: ${environment.date}`,
    `- Browser: ${environment.chromium}`,
    `- CPU: ${environment.cpu}, ${environment.cores} cores, ${environment.memoryGb} GB`,
    `- Through a proxy: ${environment.proxy ? "yes" : "no"}`,
    `- CheerpJ loader SHA-256: ${environment.loaderSha256}`,
    "",
    `| Variant | Runs (cold/warm) | Cold start, median (max); threshold ${thresholdSeconds(THRESHOLDS.coldStartMs)} | Warm start, median | Memory over baseline, median (max); threshold ${THRESHOLDS.memoryMb} MB | Peak RSS, median | First diagnostics, median | Edit diagnostics, median (max); threshold ${thresholdSeconds(THRESHOLDS.diagnosticsMs)} | Verdict |`,
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const s of summaries) {
    lines.push(
      `| ${[
        s.variant,
        `${s.coldRuns}/${s.warmRuns}`,
        `${cell(seconds(s.coldStartMs.median), s.coldStartMs.median < THRESHOLDS.coldStartMs)} (${seconds(s.coldStartMs.max)})`,
        s.warmRuns > 0 ? seconds(s.warmStartMs.median) : "n/a",
        `${cell(`${Math.round(s.memoryMb.median)} MB`, s.memoryMb.median < THRESHOLDS.memoryMb)} (${Math.round(s.memoryMb.max)} MB)`,
        `${Math.round(s.peakRssMb.median)} MB`,
        seconds(s.firstDiagnosticsMs.median),
        `${cell(seconds(s.editDiagnosticsMs.median), s.editDiagnosticsMs.median < THRESHOLDS.diagnosticsMs)} (${seconds(s.editDiagnosticsMs.max)})`,
        s.verdict.pass ? "pass" : `miss: ${s.verdict.misses.join("; ")}`,
      ].join(" | ")} |`,
    );
  }
  if (reference) {
    lines.push(
      "",
      "Plain Java reference (same jar, `java -jar`, stdio, no browser):",
      "",
      `- initialize response: ${seconds(reference.initializeMs)}`,
      `- first diagnostics after didOpen: ${seconds(reference.firstDiagnosticsMs)}`,
      `- edit diagnostics, median: ${seconds(median(reference.editDiagnosticsMs))}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseKb(status: string, field: string): number {
  const match = new RegExp(`^${field}:\\s+(\\d+)\\s*kB`, "m").exec(status);
  if (!match) throw new Error(`/proc status has no ${field}`);
  return Number(match[1]);
}

export function parseVmHwmKb(status: string): number {
  return parseKb(status, "VmHWM");
}

export function parseVmRssKb(status: string): number {
  return parseKb(status, "VmRSS");
}

export function rendererPids(): number[] {
  if (process.platform !== "linux")
    throw new Error("spike S3 memory readings need Linux /proc");
  const pids: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      if (cmdline.includes("--type=renderer")) pids.push(Number(entry));
    } catch {
      // The process ended between readdir and read.
    }
  }
  return pids;
}

export function rendererMemoryMb(pid: number): {
  rssMb: number;
  peakMb: number;
} {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  return {
    rssMb: parseVmRssKb(status) / 1024,
    peakMb: parseVmHwmKb(status) / 1024,
  };
}
