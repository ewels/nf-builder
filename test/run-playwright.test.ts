import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Runs the real `pnpm test:e2e` script with `--list`, which starts no browser and no web server. */
function listTests(grep: string) {
  const result = spawnSync(
    "pnpm",
    ["test:e2e", "--", "--grep", grep, "--list"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("pnpm test:e2e", () => {
  it("F-002: pnpm test:e2e -- --grep F-002 --list lists only F-002 tests", () => {
    const { status, output } = listTests("F-002");
    expect(status, output).toBe(0);
    const lines = output.split("\n").filter((line) => line.includes("›"));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) expect(line).toContain("F-002");
  });

  it("F-002: pnpm test:e2e -- --grep NO-SUCH-ID --list lists no tests", () => {
    const { status, output } = listTests("NO-SUCH-ID");
    expect(status).not.toBe(0);
    expect(output).toContain("No tests found");
  });

  it("F-002: runs the project's own Playwright even when none is on PATH", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-playwright.ts", "--", "--grep", "F-002", "--list"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: dirname(process.execPath) },
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status, output).toBe(0);
    expect(output).toContain("F-002");
  });
});
