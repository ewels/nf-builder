import { describe, expect, it } from "vitest";
import { lints } from "../../src/lints/index.ts";

describe("F-112 lint registry", () => {
  it("F-112 AR-05: every diagnostic code is described once, with severity, spec IDs, origin and upstream lines for ported codes", () => {
    const names = lints.codes.map((c) => c.code);
    expect(new Set(names).size).toBe(names.length);
    for (const c of lints.codes) {
      expect(c.code, c.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(["error", "warning", "suggestion"], c.code).toContain(c.severity);
      expect(c.spec.length, c.code).toBeGreaterThan(0);
      for (const id of c.spec) expect(id, c.code).toMatch(/^(LA|AR|FI)-\d{2}$/);
      expect(
        ["parser", "model", "lint", "paranoid", "ours", "internal"],
        c.code,
      ).toContain(c.origin);
      if (c.origin !== "ours" && c.origin !== "internal")
        expect(
          c.upstream.length,
          `${c.code} cites its upstream source`,
        ).toBeGreaterThan(0);
      if (c.origin === "lint")
        expect(c.lintPattern, `${c.code} has a lint pattern`).toBeInstanceOf(
          RegExp,
        );
      else expect(c.lintPattern, c.code).toBeNull();
    }
  });

  it("F-112 LA-30 AR-03: the registry describes syntax and the three include codes as errors", () => {
    const byCode = new Map(lints.codes.map((c) => [c.code, c]));
    expect(byCode.get("syntax")).toMatchObject({
      severity: "error",
      spec: ["LA-30"],
      origin: "parser",
      fixable: false,
    });
    for (const code of ["include-target", "include-not-parsed", "include-name"])
      expect(byCode.get(code), code).toMatchObject({
        severity: "error",
        spec: ["AR-03", "AR-05"],
        origin: "model",
        fixable: false,
      });
  });

  it("F-112: the registry holds exactly the planned codes", () => {
    expect(lints.codes.map((c) => c.code).sort()).toEqual(
      [
        "syntax",
        "include-target",
        "include-not-parsed",
        "include-name",
        "deprecated-when",
        "deprecated-shell",
        "deprecated-channel",
        "implicit-it",
        "deprecated-directive",
        "legacy-process",
        "legacy-workflow",
        "legacy-params",
        "params-outside-entry",
        "tuple-arity",
        "tuple-where-record",
        "publish-dir",
        "missing-type",
        "typed-process-outputs",
        "publish-type-ignored",
        "feature-flag",
        "pipeline-include-types",
        "config-include-placement",
        "config-unknown-option",
        "agent-output",
        "include-alias",
        "duplicate-name",
        "call-arity",
        "null-argument",
        "duplicate-call",
        "unused-output",
        "type-mismatch",
        "multiple-channels",
      ].sort(),
    );
    // every code but the parser and model ones has a rule, and every rule a code
    const codes = new Set(lints.codes.map((c) => c.code));
    for (const rule of lints.rules)
      expect(codes, rule.code).toContain(rule.code);
    const ruled = new Set(lints.rules.map((r) => r.code));
    for (const c of lints.codes)
      if (c.origin !== "parser" && c.origin !== "model")
        expect(ruled, c.code).toContain(c.code);
  });
});
