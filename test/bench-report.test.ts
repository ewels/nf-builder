import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BenchResult,
  benchMarkdown,
  benchReport,
  percentile,
  readTimeBudget,
  writeBenchReport,
} from "../scripts/bench-report.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const result = (coldMs: number, editMs: number): BenchResult => ({
  browser: "chromium",
  cpuThrottle: 4,
  open: {
    files: 885,
    coldMs,
    warmMs: 1500,
    progressEvents: 900,
    maxProgressGapMs: 2900,
    maxFrameGapMs: 364,
  },
  edits: [
    { kind: "addCall", ms: editMs },
    { kind: "addCall", ms: 10 },
    { kind: "replaceFileText", ms: 20 },
    { kind: "replaceFileText", ms: 30 },
  ],
});

describe("bench report", () => {
  it("F-113 step 1 QA-04: p95 is the nearest-rank percentile", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1).reverse();
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 100)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([3, 1, 2, 4], 95)).toBe(4);
    expect(() => percentile([], 95)).toThrow();
  });

  it("F-113 step 1 QA-03 QA-04 ADR-0030: the report states each measurement against its budget and never fails on a breach", () => {
    const report = benchReport(result(45000, 250));
    const rows = Object.fromEntries(report.rows.map((r) => [r.id, r]));
    expect(rows["QA-03"]).toMatchObject({
      measured: 45000,
      limit: 30000,
      within: false,
    });
    expect(rows["QA-04"]).toMatchObject({ limit: 100, within: false });
    expect(report.edits.perKind.addCall?.max).toBe(250);
    const md = benchMarkdown(report);
    expect(md).toContain("| QA-03 |");
    expect(md).toContain("| QA-04 |");
    expect(md).toContain("over");
    expect(md).toContain("reported, not gated (ADR 0030)");
    expect(md).toContain("unthrottled");
    const ok = benchReport(result(1000, 5));
    expect(ok.rows.every((r) => r.within)).toBe(true);
    expect(benchMarkdown(ok)).toContain("within");
  });

  it("F-113 step 1: a report writes bench.json and bench.md", () => {
    vi.stubEnv("GITHUB_STEP_SUMMARY", "");
    const dir = mkdtempSync(join(tmpdir(), "nf-builder-bench-"));
    dirs.push(dir);
    writeBenchReport(benchReport(result(1000, 5)), dir);
    expect(
      JSON.parse(readFileSync(join(dir, "bench.json"), "utf8")).rows,
    ).toHaveLength(2);
    expect(readFileSync(join(dir, "bench.md"), "utf8")).toContain("QA-03");
  });

  it("F-113 step 1: budgets.json holds QA-03 (30000 ms) and QA-04 (100 ms) with reasons", () => {
    const qa3 = readTimeBudget("QA-03");
    const qa4 = readTimeBudget("QA-04");
    expect(qa3.maxMs).toBe(30000);
    expect(qa4.maxMs).toBe(100);
    expect(qa3.reason.length).toBeGreaterThan(0);
    expect(qa4.reason.length).toBeGreaterThan(0);
  });
});
