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
      "oracle",
      "corpus-parse",
      "catalogue",
    ]) {
      expect(ci, job).toMatch(new RegExp(`^  ${job}:`, "m"));
    }
    for (const browser of ["chromium", "firefox", "webkit"]) {
      expect(ci, browser).toMatch(new RegExp(`browser: ${browser}`));
    }
    const jobs = ci.split(/^jobs:/m)[1] ?? "";
    const blocks = jobs.split(/^ {2}(?=[\w-]+:\s*$)/m).slice(1);
    expect(blocks.length).toBe(11);
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
      "pnpm oracle",
      "pnpm test:corpus",
      "pnpm gen:catalogue 26.10 --check",
    ]) {
      expect(ci, command).toContain(`run: ${command}`);
    }
  });

  it("F-005 ADR-0019: the oracle job sets up Temurin 21, caches .cache/nextflow keyed on upstream.json, prints the Nextflow version, runs pnpm oracle and uploads .cache/oracle even on failure", () => {
    const ci = read(join(WORKFLOWS, "ci.yml"));
    const job = ci.split(/^ {2}oracle:\s*$/m)[1] ?? "";
    expect(job).toContain("distribution: temurin");
    expect(job).toContain('java-version: "21"');
    expect(job).toContain("path: .cache/nextflow");
    expect(job).toContain("hashFiles('packages/lang-2610/upstream.json')");
    expect(job).toContain("run: pnpm nextflow -- -version");
    expect(job).toContain("run: pnpm oracle");
    expect(job).toMatch(
      /if: always\(\)\n\s+uses: actions\/upload-artifact@[0-9a-f]{40}[^\n]*\n(?:[^\n]*\n)*?\s+path: \.cache\/oracle\//,
    );
    expect(job).not.toContain("GITHUB_STEP_SUMMARY");
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

  it("F-006 step 2 ADR-0005: the corpus-parse job sets up Java and the pinned Nextflow (pnpm nextflow, ADR 0019), runs corpus:lint then test:corpus, and uploads the report", () => {
    const ci = read(join(WORKFLOWS, "ci.yml"));
    const job =
      ci.split(/^ {2}corpus-parse:\s*$/m)[1]?.split(/^ {2}[\w-]+:\s*$/m)[0] ??
      "";
    expect(job).toMatch(/name: Corpus parse vs nextflow lint/);
    const at = (needle: string | RegExp): number => {
      const index =
        typeof needle === "string" ? job.indexOf(needle) : job.search(needle);
      expect(index, String(needle)).toBeGreaterThanOrEqual(0);
      return index;
    };
    const order = [
      at("uses: ./.github/actions/setup"),
      at("uses: ./.github/actions/corpus"),
      at(/uses: actions\/setup-java@[0-9a-f]{40}/),
      at("distribution: temurin"),
      at(/java-version: "?21"?/),
      at("path: .cache/nextflow"),
      at("run: pnpm nextflow -- -version"),
      at("run: pnpm corpus:lint"),
      at("run: pnpm test:corpus"),
      at(/uses: actions\/upload-artifact@[0-9a-f]{40}/),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(job).toMatch(/hashFiles\('packages\/lang-2610\/upstream\.json'\)/);
    expect(job).toContain("path: .cache/reports/");
    expect(job).toMatch(/if: always\(\)/);
    expect(job).toContain("timeout-minutes: 20");
  });

  it("F-006 ADR-0005: the catalogue job sets up Java, caches the language server jar and fails on a catalogue diff", () => {
    const ci = read(join(WORKFLOWS, "ci.yml"));
    const job =
      ci.split(/^ {2}catalogue:\s*$/m)[1]?.split(/^ {2}[\w-]+:\s*$/m)[0] ?? "";
    expect(job).toMatch(/name: Catalogue regenerates without a diff/);
    const at = (needle: string | RegExp): number => {
      const index =
        typeof needle === "string" ? job.indexOf(needle) : job.search(needle);
      expect(index, String(needle)).toBeGreaterThanOrEqual(0);
      return index;
    };
    const order = [
      at("uses: ./.github/actions/setup"),
      at(/uses: actions\/setup-java@[0-9a-f]{40}/),
      at("distribution: temurin"),
      at(/java-version: "?21"?/),
      at(/uses: actions\/cache@[0-9a-f]{40}/),
      at("path: .cache/language-server"),
      at("run: pnpm gen:catalogue 26.10 --check"),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(job).toMatch(/hashFiles\('packages\/lang-\*\/upstream\.json'\)/);
    expect(job).toContain("timeout-minutes: 10");
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
