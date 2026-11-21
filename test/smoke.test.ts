import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SMOKE_TAG } from "../e2e/browsers.ts";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { SMOKE_BUDGET_MS, smokeArgs, smokeVerdict } from "../scripts/smoke.ts";

const read = (file: string) => readFileSync(join(REPO_ROOT, file), "utf8");

describe("pnpm smoke", () => {
  it("F-004 step 1: pnpm smoke selects at least one end-to-end test, all on Chromium", () => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      PW_BROWSERS: "firefox,webkit",
    };
    const result = spawnSync("pnpm", ["smoke", "--list"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status, output).toBe(0);
    const lines = output.split("\n").filter((line) => line.includes("›"));
    expect(
      lines.length,
      "pnpm smoke must run at least one @smoke end-to-end test (F-004 description)",
    ).toBeGreaterThanOrEqual(1);
    for (const line of lines) expect(line.trim()).toMatch(/^\[chromium\]/);
  });

  it("F-004 step 1: pnpm smoke builds the app first", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.smoke).toBe("node scripts/smoke.ts");
    expect(read("playwright.config.ts")).toContain(
      "pnpm build && pnpm preview",
    );
  });

  it("F-004 step 1: smoke fails at 60 s even when the test passes", () => {
    expect(SMOKE_BUDGET_MS).toBe(60_000);
    expect(smokeVerdict(59_999, 0).exitCode).toBe(0);
    const slow = smokeVerdict(60_000, 0);
    expect(slow.exitCode).toBe(1);
    expect(slow.message).toContain("60 s");
    expect(slow.message).toContain("F-004");
    expect(smokeVerdict(5_200, 0).message).toContain("5.2 s");
  });

  it("F-004 step 1: a failing smoke run keeps Playwright's exit code", () => {
    for (const [status, code] of [
      [1, 1],
      [3, 3],
      [null, 1],
    ] as const) {
      const verdict = smokeVerdict(5_000, status);
      expect(verdict.exitCode).toBe(code);
      expect(verdict.message).toContain("failed");
    }
  });

  it("F-004: pnpm smoke passes extra Playwright arguments through, dropping one leading --", () => {
    expect(smokeArgs([])).toEqual(["--grep", SMOKE_TAG]);
    expect(smokeArgs(["--", "--list"])).toEqual([
      "--grep",
      SMOKE_TAG,
      "--list",
    ]);
    expect(smokeArgs(["--list"])).toEqual(["--grep", SMOKE_TAG, "--list"]);
  });

  it("F-004 step 1: CI runs pnpm smoke on the Chromium leg", () => {
    const lines = read(".github/workflows/ci.yml").split("\n");
    const index = lines.findIndex((line) => line.trim() === "run: pnpm smoke");
    expect(index).toBeGreaterThan(2);
    expect(
      lines
        .slice(index - 3, index)
        .some((l) => l.includes("matrix.browser == 'chromium'")),
    ).toBe(true);
  });
});
