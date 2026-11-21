import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { selectedBrowsers } from "../e2e/browsers.ts";
import { REPO_ROOT } from "../scripts/check-common.ts";

function list(env: Record<string, string>, args: string[]): string[] {
  const result = spawnSync(
    process.execPath,
    ["scripts/run-playwright.ts", "--list", ...args],
    { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, ...env } },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("["));
}

function titles(lines: string[], browser: string): string[] {
  return lines
    .filter((line) => line.startsWith(`[${browser}]`))
    .map((line) => line.replace(/^\[[^\]]+\] › /, ""))
    .sort();
}

describe("e2e browser selection", () => {
  it("F-003 QA-20: e2e runs use Chromium only unless PW_BROWSERS says otherwise", () => {
    expect(selectedBrowsers(undefined)).toEqual(["chromium"]);
    expect(selectedBrowsers("")).toEqual(["chromium"]);
  });

  it("F-003 QA-20: PW_BROWSERS selects any of chromium, firefox and webkit", () => {
    expect(selectedBrowsers(" firefox,webkit,firefox ")).toEqual([
      "firefox",
      "webkit",
    ]);
    expect(selectedBrowsers("chromium,firefox,webkit")).toEqual([
      "chromium",
      "firefox",
      "webkit",
    ]);
  });

  it("F-003 QA-20: an unknown PW_BROWSERS value fails, listing the valid names", () => {
    expect(() => selectedBrowsers("safari")).toThrow(
      'PW_BROWSERS: unknown browser "safari"; use chromium, firefox or webkit, comma-separated',
    );
  });

  it("F-003 QA-20: Firefox and WebKit list exactly the @smoke tests; Chromium lists every test", () => {
    const smoke = titles(
      list({ PW_BROWSERS: "chromium" }, ["--grep", "@smoke"]),
      "chromium",
    );
    expect(smoke.length).toBeGreaterThan(0);
    const all = list({ PW_BROWSERS: "chromium,firefox,webkit" }, []);
    expect(titles(all, "firefox")).toEqual(smoke);
    expect(titles(all, "webkit")).toEqual(smoke);
    const chromium = titles(all, "chromium");
    expect(chromium.length).toBeGreaterThan(smoke.length);
    for (const title of smoke) expect(chromium).toContain(title);
  });

  it("F-003 QA-20: --grep also narrows the smoke-only browsers", () => {
    const smoke = titles(
      list({ PW_BROWSERS: "chromium" }, ["--grep", "@smoke"]),
      "chromium",
    ).filter((t) => t.includes("F-002"));
    const firefox = titles(
      list({ PW_BROWSERS: "firefox" }, ["--grep", "F-002"]),
      "firefox",
    );
    expect(firefox).toEqual(smoke);
  });
});
