import { describe, expect, it } from "vitest";
import {
  evaluateLint,
  evaluateRun,
  parseLintJson,
  stripAnsi,
} from "../src/check.ts";
import type { ExecResult } from "../src/nextflow.ts";

const result = (over: Partial<ExecResult>): ExecResult => ({
  status: 0,
  signal: null,
  stdout: "",
  stderr: "",
  durationMs: 1,
  ...over,
});
const msg = (message: string) => ({
  filename: "main.nf",
  startLine: 3,
  startColumn: 1,
  message,
});
const json = (
  errors: ReturnType<typeof msg>[],
  warnings = errors.slice(0, 0),
) => JSON.stringify({ date: "d", summary: {}, errors, warnings }, null, 2);

describe("F-005 checks", () => {
  it("F-005: parseLintJson reads the nextflow lint -o json report even after other output", () => {
    const out = `Picked up JAVA_TOOL_OPTIONS: -Xx\n${json([msg("boom")], [msg("hmm")])}\n`;
    const report = parseLintJson(out);
    expect(report?.errors.map((e) => e.message)).toEqual(["boom"]);
    expect(report?.warnings.map((e) => e.message)).toEqual(["hmm"]);
    expect(parseLintJson("garbage")).toBeNull();
    expect(parseLintJson("{\nnot json\n")).toBeNull();
  });

  it("F-005: a lint check matches when the exit status agrees with expect, warnings allowed", () => {
    const ok = evaluateLint(
      { expect: "ok", errors: [] },
      result({ stdout: json([], [msg("warn")]) }),
    );
    expect(ok.matched).toBe(true);
    expect(ok.warnings).toEqual(["warn"]);
    const bad = evaluateLint(
      { expect: "error", errors: ["boom"] },
      result({ status: 1, stdout: json([msg("big boom")]) }),
    );
    expect(bad.matched).toBe(true);
    expect(bad.actual).toBe("error");
  });

  it("F-005: a lint check with expect error fails when an expected error text is missing and quotes the actual errors", () => {
    const r = evaluateLint(
      { expect: "error", errors: ["missing text"] },
      result({ status: 1, stdout: json([msg("something else")]) }),
    );
    expect(r.matched).toBe(false);
    const problems = r.problems.join("\n");
    expect(problems).toContain("missing text");
    expect(problems).toContain("something else");
  });

  it("F-005: a lint check with expect ok fails on a non-zero exit and quotes the first error", () => {
    const r = evaluateLint(
      { expect: "ok", errors: [] },
      result({ status: 1, stdout: json([msg("first"), msg("second")]) }),
    );
    expect(r.matched).toBe(false);
    expect(r.problems.join("\n")).toContain("first");
  });

  it("F-005: a run check finds expected output texts in stdout or stderr, ignoring ANSI codes", () => {
    const spec = {
      expect: "ok" as const,
      output: ["alpha", "beta"],
      script: "main.nf",
      args: ["-stub"],
    };
    const r = evaluateRun(
      spec,
      result({ stdout: "\u001b[32malpha\u001b[0m", stderr: "beta" }),
    );
    expect(r.matched).toBe(true);
    expect(stripAnsi("\u001b[1mx\u001b[0m")).toBe("x");
    const missing = evaluateRun(spec, result({ stdout: "alpha" }));
    expect(missing.matched).toBe(false);
    expect(missing.problems.join("\n")).toContain("beta");
  });

  it("F-005: a run check with expect error fails when Nextflow exits 0", () => {
    const r = evaluateRun(
      { expect: "error", output: [], script: "main.nf", args: ["-stub"] },
      result({}),
    );
    expect(r.matched).toBe(false);
    expect(r.actual).toBe("ok");
  });
});
