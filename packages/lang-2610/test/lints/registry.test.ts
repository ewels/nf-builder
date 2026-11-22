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
      for (const id of c.spec) expect(id, c.code).toMatch(/^(LA|AR)-\d{2}$/);
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
});
