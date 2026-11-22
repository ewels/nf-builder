import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import config from "../apps/web/vite.config.ts";
import {
  type Budget,
  budgetReport,
  checkBundleBudget,
  initialJsFiles,
  type Manifest,
  readBudget,
} from "../scripts/check-bundle-budget.ts";
import { REPO_ROOT } from "../scripts/check-common.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const budget = (maxBytes: number): Budget => ({
  id: "QA-01",
  description: "Initial JavaScript",
  maxBytes,
  reason: "test",
});

const HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor.js">
</head><body></body></html>`;

function makeDist(
  files: Record<string, string | Buffer>,
  manifest?: Manifest | null,
  html = HTML,
): string {
  const dir = mkdtempSync(join(tmpdir(), "nf-builder-budget-"));
  dirs.push(dir);
  const all: Record<string, string | Buffer> = { "index.html": html, ...files };
  if (manifest) all[".vite/manifest.json"] = JSON.stringify(manifest);
  for (const [name, content] of Object.entries(all)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

const MANIFEST: Manifest = {
  "index.html": {
    file: "assets/index.js",
    isEntry: true,
    imports: ["_vendor.js"],
    dynamicImports: ["src/lazy.ts"],
    css: ["assets/index.css"],
  },
  "_vendor.js": { file: "assets/vendor.js", imports: ["_shared.js"] },
  "_shared.js": { file: "assets/shared.js" },
  "src/lazy.ts": {
    file: "assets/lazy.js",
    isDynamicEntry: true,
    imports: ["_lazy-vendor.js"],
  },
  "_lazy-vendor.js": { file: "assets/lazy-vendor.js" },
};

const rand = (n: number) => randomBytes(n).toString("base64");

describe("QA-01 bundle budget", () => {
  it("QA-01 F-011: initialJsFiles strips the base path from script and modulepreload URLs, so a /nf-builder/ build counts the same files", () => {
    const html = HTML.replaceAll('"/assets/', '"/nf-builder/assets/');
    expect([...initialJsFiles(MANIFEST, html, "/nf-builder/")].sort()).toEqual([
      "assets/index.js",
      "assets/shared.js",
      "assets/vendor.js",
    ]);
  });

  it("F-003 QA-01: initial JS is the HTML entry chunk plus its static imports, not dynamic imports", () => {
    expect([...initialJsFiles(MANIFEST, HTML)].sort()).toEqual([
      "assets/index.js",
      "assets/shared.js",
      "assets/vendor.js",
    ]);
  });

  it("F-003 QA-01: scripts and modulepreload links in index.html count even if the manifest omits them", () => {
    const html = `<script src="/assets/a.js" type="module"></script>
<link crossorigin rel="modulepreload" href="/assets/b.js">`;
    const manifest: Manifest = { "index.html": { file: "assets/a.js" } };
    expect([...initialJsFiles(manifest, html)].sort()).toEqual([
      "assets/a.js",
      "assets/b.js",
    ]);
  });

  it("F-003 QA-01: passes under budget and reports the summed gzip size", () => {
    const files = {
      "assets/index.js": rand(3000),
      "assets/vendor.js": rand(5000),
      "assets/shared.js": rand(1000),
    };
    const dist = makeDist(files, MANIFEST);
    const result = checkBundleBudget(dist, budget(1_000_000));
    const expected = Object.values(files).reduce(
      (sum, c) => sum + gzipSync(Buffer.from(c)).length,
      0,
    );
    expect(result.ok).toBe(true);
    expect(result.totalGzipBytes).toBe(expected);
    const report = budgetReport(result);
    for (const f of Object.keys(files)) expect(report).toContain(f);
    expect(report).toContain("Total");
  });

  it("F-003 step 2: QA-01 fails over budget, naming the excess, the largest files and both fixes", () => {
    const dist = makeDist(
      {
        "assets/index.js": rand(3000),
        "assets/vendor.js": rand(20000),
        "assets/shared.js": rand(1000),
      },
      MANIFEST,
    );
    const result = checkBundleBudget(dist, budget(1000));
    expect(result.ok).toBe(false);
    const message = result.problems.map((p) => p.message).join("\n");
    expect(message).toContain("over the");
    expect(message).toContain("assets/vendor.js");
    expect(message).toContain("import()");
    expect(message).toContain("scripts/budgets.json");
  });

  it("F-003 QA-01: a build without a Vite manifest fails, saying to set build.manifest", () => {
    const dist = makeDist({ "assets/index.js": "x" }, null);
    const result = checkBundleBudget(dist, budget(1000));
    expect(result.ok).toBe(false);
    expect(result.problems[0]?.message).toContain("build.manifest: true");
  });

  it("F-003 QA-01: a manifest import that is not in the manifest is reported", () => {
    const manifest: Manifest = {
      "index.html": { file: "assets/index.js", imports: ["_gone.js"] },
    };
    const dist = makeDist(
      { "assets/index.js": "x", "assets/vendor.js": "y" },
      manifest,
    );
    const result = checkBundleBudget(dist, budget(1_000_000));
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.message).join("\n")).toContain(
      "_gone.js",
    );
  });

  it("F-003 QA-01: scripts/budgets.json holds the QA-01 limit with a reason", () => {
    const b = readBudget("QA-01");
    expect(Number.isInteger(b.maxBytes)).toBe(true);
    expect(b.maxBytes).toBeGreaterThan(0);
    expect(b.reason.length).toBeGreaterThan(0);
  });

  it("F-003 QA-01: the web build writes a Vite manifest", () => {
    expect(config.build?.manifest).toBe(true);
  });

  it("F-003 step 2: node scripts/check-bundle-budget.ts exits 1 over budget and 2 without a build", () => {
    const dist = makeDist(
      {
        "assets/index.js": rand(3000),
        "assets/vendor.js": rand(3000),
        "assets/shared.js": rand(300),
      },
      MANIFEST,
    );
    const tmp = mkdtempSync(join(tmpdir(), "nf-builder-budgets-"));
    dirs.push(tmp);
    const budgets = join(tmp, "budgets.json");
    writeFileSync(
      budgets,
      JSON.stringify({
        "QA-01": { description: "d", maxBytes: 100, reason: "r" },
      }),
    );
    const run = (...args: string[]) =>
      spawnSync("node", ["scripts/check-bundle-budget.ts", ...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" },
      });
    const over = run("--dist", dist, "--budgets", budgets);
    expect(over.status).toBe(1);
    expect(over.stdout).toContain("QA-01");
    const missing = run("--dist", join(tmp, "nope"));
    expect(missing.status).toBe(2);
    expect(missing.stdout + missing.stderr).toContain("run pnpm build");
  });
});
