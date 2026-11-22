// QA-01: bundle-size budget. Budgets live in scripts/budgets.json.
//
// Initial JavaScript is every JavaScript file the browser loads before any dynamic import() runs:
// - start from the Vite manifest entry "index.html" (its `file`) plus every <script src> and
//   <link rel="modulepreload" href> in dist/index.html;
// - add the transitive closure over manifest `imports` (static imports);
// - chunks reachable only through `dynamicImports` are excluded (ADR 0003: Monaco and the optional
//   language server are lazy-loaded, so a static import of them blows the budget);
// - CSS is excluded, and worker bundles are excluded until F-702.
// Size is the gzip size (node:zlib, default level) of each file, summed. 1 kB = 1000 bytes, as in Vite's log.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { basePath } from "./base-path.ts";
import {
  distExists,
  isMain,
  type Problem,
  REPO_ROOT,
  reportProblems,
  WEB_DIST,
} from "./check-common.ts";

type ManifestChunk = {
  file: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
};
export type Manifest = Record<string, ManifestChunk>;
export type Budget = {
  id: string;
  description: string;
  maxBytes: number;
  reason: string;
};
type SizedFile = { file: string; bytes: number; gzipBytes: number };
type BudgetResult = {
  ok: boolean;
  budget: Budget;
  files: SizedFile[];
  totalGzipBytes: number;
  problems: Problem[];
};

const BUDGETS_FILE: string = join(REPO_ROOT, "scripts/budgets.json");
const MANIFEST_PATH = ".vite/manifest.json";

export function readBudget(id: string, file: string = BUDGETS_FILE): Budget {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `${file}: cannot read budgets: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entry = (data as Record<string, unknown> | null)?.[id];
  if (typeof entry !== "object" || entry === null)
    throw new Error(`${file}: no budget "${id}"`);
  const e = entry as Record<string, unknown>;
  if (
    typeof e.maxBytes !== "number" ||
    !Number.isInteger(e.maxBytes) ||
    e.maxBytes <= 0
  )
    throw new Error(`${file}: ${id}.maxBytes must be a positive integer`);
  if (typeof e.description !== "string" || e.description === "")
    throw new Error(`${file}: ${id}.description must be a non-empty string`);
  if (typeof e.reason !== "string" || e.reason === "")
    throw new Error(`${file}: ${id}.reason must be a non-empty string`);
  return {
    id,
    description: e.description,
    maxBytes: e.maxBytes,
    reason: e.reason,
  };
}

/** `url` relative to dist: the base path (default `/`) stripped from the front. */
function stripBase(url: string, base: string): string {
  return url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, "");
}

/** Dist-relative paths of `<script src>` and `<link rel="modulepreload" href>` (attribute order free). */
function htmlScripts(html: string, base: string): string[] {
  const found: string[] = [];
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const text = tag[0];
    const isScript = tag[1]?.toLowerCase() === "script";
    if (!isScript && !/\brel\s*=\s*["']?modulepreload\b/i.test(text)) continue;
    const attr = isScript ? "src" : "href";
    const url = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, "i").exec(
      text,
    )?.[1];
    if (url !== undefined) found.push(stripBase(url, base));
  }
  return found;
}

function collect(
  manifest: Manifest,
  html: string,
  base: string,
): { files: string[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const files = new Set<string>();
  const byFile = new Map<string, string>();
  for (const [key, chunk] of Object.entries(manifest))
    byFile.set(chunk.file, key);
  const queue: string[] = [];
  const seen = new Set<string>();
  const entry = manifest["index.html"];
  if (entry === undefined)
    problems.push({
      message: `${MANIFEST_PATH} has no "index.html" entry; check that apps/web/index.html is the Vite entry`,
    });
  else {
    files.add(entry.file);
    queue.push("index.html");
  }
  for (const src of htmlScripts(html, base)) {
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)) {
      problems.push({
        file: "index.html",
        message: `index.html loads the external script ${src}; initial JavaScript must be served from the app itself (ADR 0002)`,
      });
      continue;
    }
    files.add(src);
    const key = byFile.get(src);
    if (key !== undefined) queue.push(key);
  }
  while (queue.length > 0) {
    const key = queue.pop() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = manifest[key];
    if (chunk === undefined) continue;
    files.add(chunk.file);
    for (const imported of chunk.imports ?? []) {
      const target = manifest[imported];
      if (target === undefined)
        problems.push({
          message: `${MANIFEST_PATH}: "${key}" imports "${imported}", which is not in the manifest; rebuild with pnpm build`,
        });
      else queue.push(imported);
    }
  }
  return {
    files: [...files].filter((f) => /\.(?:m?js|cjs)$/.test(f)),
    problems,
  };
}

/** Dist-relative paths of the initial JavaScript files (see the header for the definition). */
export function initialJsFiles(
  manifest: Manifest,
  html: string,
  base = "/",
): string[] {
  return collect(manifest, html, base).files;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

export function checkBundleBudget(
  distDir: string,
  budget: Budget,
  base = "/",
): BudgetResult {
  const fail = (problems: Problem[]): BudgetResult => ({
    ok: false,
    budget,
    files: [],
    totalGzipBytes: 0,
    problems,
  });
  const manifestFile = join(distDir, MANIFEST_PATH);
  if (!existsSync(manifestFile))
    return fail([
      {
        message: `dist/${MANIFEST_PATH} not found; apps/web/vite.config.ts must set build.manifest: true`,
      },
    ]);
  const htmlFile = join(distDir, "index.html");
  if (!existsSync(htmlFile))
    return fail([{ message: "dist/index.html not found: run pnpm build" }]);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest;
  } catch (error) {
    return fail([
      {
        file: manifestFile,
        message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
  const { files: names, problems } = collect(
    manifest,
    readFileSync(htmlFile, "utf8"),
    base,
  );
  const files: SizedFile[] = [];
  for (const name of names) {
    const path = join(distDir, name);
    if (!existsSync(path)) {
      problems.push({
        message: `dist/${name} is loaded by index.html or the manifest but is not in dist; rebuild with pnpm build`,
      });
      continue;
    }
    const content = readFileSync(path);
    files.push({
      file: name,
      bytes: content.length,
      gzipBytes: gzipSync(content).length,
    });
  }
  const totalGzipBytes = files.reduce((sum, f) => sum + f.gzipBytes, 0);
  if (totalGzipBytes > budget.maxBytes) {
    const largest = [...files]
      .sort((a, b) => b.gzipBytes - a.gzipBytes)
      .slice(0, 3)
      .map((f) => `${f.file} ${formatKb(f.gzipBytes)}`)
      .join(", ");
    problems.push({
      message: `${budget.id}: initial JavaScript is ${formatKb(totalGzipBytes)} gzipped, ${formatKb(totalGzipBytes - budget.maxBytes)} over the ${formatKb(budget.maxBytes)} budget (scripts/budgets.json). Largest: ${largest}. Fix: load heavy modules with import() so they leave the initial bundle (ADR 0003 requires this for Monaco), or raise ${budget.id}.maxBytes in scripts/budgets.json with a reason in the same PR (docs/spec/quality.md).`,
    });
  }
  return {
    ok: problems.length === 0,
    budget,
    files,
    totalGzipBytes,
    problems,
  };
}

export function budgetReport(result: BudgetResult): string {
  const { budget, files, totalGzipBytes } = result;
  const rows = files.map(
    (f) => `| ${f.file} | ${formatKb(f.bytes)} | ${formatKb(f.gzipBytes)} |`,
  );
  const headroom = (
    ((budget.maxBytes - totalGzipBytes) / budget.maxBytes) *
    100
  ).toFixed(1);
  return [
    `### ${budget.id}: ${budget.description}`,
    "",
    "| File | Raw | Gzip |",
    "|---|---|---|",
    ...rows,
    "",
    `Total gzip: ${formatKb(totalGzipBytes)} of ${formatKb(budget.maxBytes)} (headroom ${headroom}%)`,
    "",
  ].join("\n");
}

function main(argv: string[]): number {
  let dist = WEB_DIST;
  let budgets = BUDGETS_FILE;
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--dist" && next !== undefined)
      dist = resolve(argv[++i] ?? "");
    else if (argv[i] === "--budgets" && next !== undefined)
      budgets = resolve(argv[++i] ?? "");
    else {
      console.error(
        "usage: node scripts/check-bundle-budget.ts [--dist <path>] [--budgets <path>]",
      );
      return 2;
    }
  }
  if (!distExists(dist)) return 2;
  let base: string;
  let budget: Budget;
  try {
    base = basePath(process.env);
    budget = readBudget("QA-01", budgets);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const result = checkBundleBudget(dist, budget, base);
  const report = budgetReport(result);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (!reportProblems(budget.id, result.problems)) return 1;
  console.log(
    `${budget.id}: initial JavaScript is ${formatKb(result.totalGzipBytes)} gzipped, within the ${formatKb(budget.maxBytes)} budget`,
  );
  return 0;
}

if (isMain(import.meta)) process.exitCode = main(process.argv.slice(2));
