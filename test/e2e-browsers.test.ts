import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  selectedBrowsers,
  VISUAL_TAG,
  visualEnabled,
} from "../e2e/browsers.ts";
import config from "../playwright.config.ts";
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

// Each spawned `playwright --list` takes 1 to 2 s, and longer on a busy machine; the 5 s default timed out under load.
describe("e2e browser selection", { timeout: 30_000 }, () => {
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
  it("F-010 ADR-0024: spike S5 runs in its own one-worker Chromium project, so --repeat-each cannot start two servers, and no other project collects it", () => {
    const all = list({ PW_BROWSERS: "chromium,firefox,webkit" }, []);
    const spike = all.filter((line) =>
      line.includes("spike-s5-nf-metro.spec.ts"),
    );
    expect(spike.length).toBeGreaterThanOrEqual(4);
    for (const line of spike) expect(line).toMatch(/^\[chromium-spikes\] /);
    const project = config.projects?.find((p) => p.name === "chromium-spikes");
    expect(project?.workers).toBe(1);
    const smoke = list({ PW_BROWSERS: "chromium,firefox,webkit" }, [
      "--grep",
      "@smoke",
    ]);
    expect(smoke.filter((line) => line.includes("spike-"))).toEqual([]);
  });

  it("F-201 ADR-0021: @visual tests are listed on Chromium only, and only when CI or PW_VISUAL=1 is set", () => {
    expect(VISUAL_TAG).toBe("@visual");
    expect(visualEnabled({})).toBe(false);
    expect(visualEnabled({ CI: "", PW_VISUAL: "" })).toBe(false);
    expect(visualEnabled({ PW_VISUAL: "0" })).toBe(false);
    expect(visualEnabled({ CI: "true" })).toBe(true);
    expect(visualEnabled({ PW_VISUAL: "1" })).toBe(true);
    // Nothing matches, so Playwright exits non-zero with "No tests found".
    const off = spawnSync(
      process.execPath,
      ["scripts/run-playwright.ts", "--list", "--grep", "@visual"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, CI: "", PW_VISUAL: "", PW_BROWSERS: "chromium" },
      },
    );
    expect(off.stdout).toContain("Total: 0 tests");
    const on = list({ CI: "true", PW_BROWSERS: "chromium,firefox,webkit" }, [
      "--grep",
      "@visual",
    ]);
    expect(titles(on, "chromium").length).toBeGreaterThanOrEqual(1);
    expect(titles(on, "firefox")).toEqual([]);
    expect(titles(on, "webkit")).toEqual([]);
  });

  it("F-201 ADR-0021: a missing or changed baseline fails rather than being written, and baselines live in e2e/__screenshots__", () => {
    expect(config.updateSnapshots).toBe("none");
    expect(config.snapshotPathTemplate).toMatch(
      /^\{testDir\}\/__screenshots__\//,
    );
  });
});
