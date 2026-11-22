import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../scripts/check-common.ts";

const WORKFLOWS = join(REPO_ROOT, ".github/workflows");
const ACTIONS = join(REPO_ROOT, ".github/actions");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => join(dir, f));
}

describe("CI workflows", () => {
  it("F-003 step 1 ADR-0011: ci.yml runs on pull requests and pushes to main and defines every check job", () => {
    const ci = read(join(WORKFLOWS, "ci.yml"));
    expect(ci).toMatch(/^\s*pull_request:/m);
    expect(ci).toMatch(/^\s*push:\s*\n\s*branches: \[main\]/m);
    for (const job of [
      "check",
      "e2e",
      "budget",
      "hosts",
      "adr-lint",
      "features",
      "audit",
      "corpus",
    ]) {
      expect(ci, job).toMatch(new RegExp(`^  ${job}:`, "m"));
    }
    for (const browser of ["chromium", "firefox", "webkit"]) {
      expect(ci, browser).toMatch(new RegExp(`browser: ${browser}`));
    }
    const jobs = ci.split(/^jobs:/m)[1] ?? "";
    const blocks = jobs.split(/^ {2}(?=[\w-]+:\s*$)/m).slice(1);
    expect(blocks.length).toBe(8);
    for (const block of blocks) expect(block).toContain("timeout-minutes:");
    for (const command of [
      "pnpm check",
      "pnpm test:e2e",
      "pnpm check:budget",
      "pnpm check:hosts",
      "node scripts/check-adrs.ts",
      "node scripts/check-features.ts",
      "pnpm audit --audit-level high",
      "pnpm corpus:fetch --check",
    ]) {
      expect(ci, command).toContain(`run: ${command}`);
    }
  });

  it("F-003: every action in .github/workflows and .github/actions is pinned to a full commit SHA with a version comment", () => {
    const files = [...yamlFiles(WORKFLOWS), ...yamlFiles(ACTIONS)];
    expect(files.length).toBeGreaterThan(2);
    let count = 0;
    for (const file of files) {
      for (const line of read(file).split("\n")) {
        const m = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/);
        if (!m) continue;
        count++;
        const [, value = "", rest = ""] = m;
        if (value.startsWith("./")) continue;
        expect(value, `${file}: ${line}`).toMatch(
          /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/,
        );
        expect(rest, `${file}: ${line}`).toMatch(/^\s+# v\d+(\.\d+)*\s*$/);
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it("F-003: every workflow sets top-level permissions", () => {
    for (const file of yamlFiles(WORKFLOWS)) {
      expect(read(file), file).toMatch(/^permissions:/m);
    }
  });

  it("F-009 ADR-0011: the corpus job restores .cache/corpus from the Actions cache keyed on corpus.yaml, fetches, then checks the cache is complete", () => {
    const action = read(join(ACTIONS, "corpus/action.yml"));
    expect(action).toMatch(/uses: actions\/cache@[0-9a-f]{40}/);
    expect(action).toContain("path: .cache/corpus");
    expect(action).toMatch(/key: .*hashFiles\('tools\/corpus\/corpus\.yaml'\)/);
    expect(action).toContain("run: pnpm corpus:fetch");
    const ci = read(join(WORKFLOWS, "ci.yml"));
    const job = ci.split(/^ {2}corpus:\s*$/m)[1] ?? "";
    const setup = job.indexOf("uses: ./.github/actions/setup");
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(job.indexOf("uses: ./.github/actions/corpus")).toBeGreaterThan(
      setup,
    );
    expect(job).toContain("run: pnpm corpus:fetch --check");
  });

  it("F-009: the setup action only enables the pnpm cache when it installs", () => {
    const action = read(join(ACTIONS, "setup/action.yml"));
    expect(action).toMatch(
      /cache: \$\{\{ inputs\.install == 'true' && 'pnpm' \|\| '' \}\}/,
    );
    expect(action).not.toMatch(/cache: pnpm\s*$/m);
  });

  it("F-003 QA-34: renovate.json pins GitHub Actions by digest and groups updates", () => {
    const config = JSON.parse(read(join(REPO_ROOT, "renovate.json"))) as {
      extends: string[];
      packageRules: { matchManagers?: string[]; groupName?: string }[];
    };
    expect(config.extends).toContain("config:recommended");
    expect(config.extends).toContain("helpers:pinGitHubActionDigests");
    expect(
      config.packageRules.some(
        (r) => r.matchManagers?.includes("github-actions") && r.groupName,
      ),
    ).toBe(true);
  });
  it("F-201 ADR-0021: the e2e job runs on a pinned runner image and uploads the report and test-results (with the actual screenshots) when it fails", () => {
    const ci = read(join(WORKFLOWS, "ci.yml"));
    const job = /^ {2}e2e:\s*$([\s\S]*?)^ {2}budget:/m.exec(ci)?.[1] ?? "";
    expect(job).toMatch(/runs-on: ubuntu-24\.04\s*$/m);
    expect(job).not.toContain("ubuntu-latest");
    const upload =
      /- name: Upload the Playwright report and traces\n([\s\S]*?)(?=\n {6}- |\n\S|$)/.exec(
        job,
      )?.[1] ?? "";
    expect(upload).toMatch(/if: failure\(\)/);
    expect(upload).toContain("uses: actions/upload-artifact@");
    expect(upload).toContain("playwright-report/");
    expect(upload).toContain("test-results/");
  });
});
