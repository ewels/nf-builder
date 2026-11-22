// F-501: checks a registry snapshot (IO-31) before it is published or after it is deployed.
// - QA-06: registry/index.json is at most the QA-06 budget in scripts/budgets.json when gzipped (node:zlib, default level).
// - Integrity: format 1; ports for every module; a bundle for every module and every pinned version; a file for every plugin.
// Imports only node: built-ins and sibling scripts, so the workflow can run it without building anything.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { type Budget, readBudget } from "./check-bundle-budget.ts";
import { isMain, type Problem, reportProblems } from "./check-common.ts";

type Json = Record<string, unknown>;
type SnapshotCheck = {
  ok: boolean;
  indexGzipBytes: number;
  problems: Problem[];
  warnings: Problem[];
};

const WARN_RATIO = 0.9;
const kb = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB`;
const bundlePath = (name: string, version: string): string =>
  `registry/modules/${name}/${version}.json`;
const pluginPath = (id: string, version: string): string =>
  `registry/plugins/${id}/${version}.json`;

type Sample = { modules: number; plugins: number };

/** The post-deploy sample (ADR 0041): about 27 requests. A full check runs on the build before it is uploaded. */
export const DEPLOYED_SAMPLE: Sample = { modules: 20, plugins: 5 };

/** `n` items spread evenly over `items`, always keeping the first and last; all of them when n >= items.length. */
export function evenlySpaced<T>(items: readonly T[], n: number): T[] {
  if (n >= items.length) return [...items];
  if (n === 1) return items.slice(0, 1);
  const picked: T[] = [];
  for (let i = 0; i < n; i++)
    picked.push(items[Math.round((i * (items.length - 1)) / (n - 1))] as T);
  return picked;
}

/**
 * Checks the snapshot's index, ports, bundles and plugin files, read through `read` (a path or undefined).
 * With a `sample`, only that many evenly spaced modules and plugins are read, and a bundle's `requires` aren't followed.
 */
function checkContents(
  read: (path: string) => string | undefined,
  budget: Budget,
  where: string,
  sample?: Sample,
): SnapshotCheck {
  const problems: Problem[] = [];
  const warnings: Problem[] = [];
  const fail = (message: string): void => void problems.push({ message });
  const parse = (path: string): Json | undefined => {
    const text = read(path);
    if (text === undefined) {
      fail(`${where}/${path} is missing`);
      return undefined;
    }
    try {
      return JSON.parse(text) as Json;
    } catch (error) {
      fail(
        `${where}/${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  };
  const indexText = read("registry/index.json");
  const indexGzipBytes =
    indexText === undefined ? 0 : gzipSync(indexText).length;
  const index = parse("registry/index.json");
  if (index === undefined)
    return { ok: false, indexGzipBytes, problems, warnings };

  if (index.format !== 1)
    fail(
      `${where}/registry/index.json has format ${String(index.format)}, expected 1`,
    );
  if (indexGzipBytes > budget.maxBytes)
    fail(
      `${budget.id}: registry/index.json is ${kb(indexGzipBytes)} gzipped, ${kb(indexGzipBytes - budget.maxBytes)} over the ${kb(budget.maxBytes)} limit (scripts/budgets.json). Fix: move fields out of the index into ports.json or the bundles, or raise ${budget.id}.maxBytes with a reason in the same PR (docs/spec/quality.md).`,
    );
  else if (indexGzipBytes > budget.maxBytes * WARN_RATIO)
    warnings.push({
      message: `${budget.id}: registry/index.json is ${kb(indexGzipBytes)} gzipped, above 90% of the ${kb(budget.maxBytes)} limit`,
    });

  const ports = parse("registry/ports.json");
  if (ports) {
    if (ports.format !== 1)
      fail(
        `${where}/registry/ports.json has format ${String(ports.format)}, expected 1`,
      );
    if (ports.generatedAt !== index.generatedAt)
      fail(
        `registry/ports.json generatedAt ${String(ports.generatedAt)} differs from the index's ${String(index.generatedAt)}`,
      );
  }
  const portsByName = (ports?.modules ?? {}) as Json;

  const queue: string[] = [];
  const allModules = (index.modules ?? []) as {
    name: string;
    version: string;
  }[];
  for (const m of sample
    ? evenlySpaced(allModules, sample.modules)
    : allModules) {
    if (ports && !(m.name in portsByName))
      fail(`registry/ports.json has no ports for ${m.name}`);
    queue.push(bundlePath(m.name, m.version));
  }
  const seen = new Set<string>();
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (seen.has(path)) continue;
    seen.add(path);
    const bundle = parse(path);
    if (!bundle) continue;
    if (bundle.format !== 1)
      fail(`${path} has format ${String(bundle.format)}, expected 1`);
    if (path !== bundlePath(String(bundle.name), String(bundle.version)))
      fail(`${path} holds ${String(bundle.name)}@${String(bundle.version)}`);
    if (!sample)
      for (const pin of (bundle.requires ?? []) as {
        name: string;
        version: string;
      }[])
        queue.push(bundlePath(pin.name, pin.version));
  }
  const allPlugins = (index.plugins ?? []) as { id: string; version: string }[];
  for (const p of sample
    ? evenlySpaced(allPlugins, sample.plugins)
    : allPlugins) {
    const path = pluginPath(p.id, p.version);
    const file = parse(path);
    if (
      file &&
      (file.format !== 1 || file.id !== p.id || file.version !== p.version)
    )
      fail(`${path} does not hold ${p.id}@${p.version} in format 1`);
  }
  return { ok: problems.length === 0, indexGzipBytes, problems, warnings };
}

export function checkRegistrySnapshot(dir: string): SnapshotCheck {
  const read = (path: string): string | undefined => {
    const file = join(dir, path);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  };
  return checkContents(read, readBudget("QA-06"), dir);
}

type DeployedOptions = {
  /** Undefined checks every file. */
  sample?: Sample;
  timeoutMs: number;
  intervalMs: number;
  log?: (message: string) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Polls `<site>/registry/index.json` until it is JSON with this `generatedAt` (a host with a fallback may answer a missing file
 * with HTML and status 200), then checks the served snapshot: the index, ports, and every module bundle and plugin file, or a `sample` of them.
 * Every GET carries a `?ts=` query, because Pages caches responses for ten minutes.
 */
export async function checkDeployedSnapshot(
  site: string,
  generatedAt: string,
  options: DeployedOptions,
): Promise<SnapshotCheck> {
  const doFetch = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const base = site.replace(/\/$/, "");
  const get = async (path: string): Promise<string | undefined> => {
    try {
      const response = await doFetch(`${base}/${path}?ts=${now()}`);
      const type = response.headers.get("content-type") ?? "";
      return response.ok && type.includes("json")
        ? await response.text()
        : undefined;
    } catch {
      return undefined;
    }
  };
  const served = (text: string | undefined): boolean => {
    try {
      return (
        text !== undefined &&
        (JSON.parse(text) as Json).generatedAt === generatedAt
      );
    } catch {
      return false;
    }
  };
  const deadline = now() + options.timeoutMs;
  let indexText = await get("registry/index.json");
  while (!served(indexText)) {
    if (now() + options.intervalMs > deadline)
      return {
        ok: false,
        indexGzipBytes: 0,
        warnings: [],
        problems: [
          {
            message: `${base} did not serve the snapshot generated at ${generatedAt} within ${Math.round(options.timeoutMs / 1000)} s`,
          },
        ],
      };
    log(`waiting for ${base} to serve ${generatedAt}`);
    await sleep(options.intervalMs);
    indexText = await get("registry/index.json");
  }
  // Run the content checks on copies, fetching each file they ask for, until they ask for nothing new.
  const cache = new Map([["registry/index.json", indexText]]);
  for (;;) {
    const missing = new Set<string>();
    const result = checkContents(
      (path) => {
        if (!cache.has(path)) missing.add(path);
        return cache.get(path);
      },
      readBudget("QA-06"),
      base,
      options.sample,
    );
    if (missing.size === 0) return result;
    for (const path of missing) cache.set(path, await get(path));
  }
}

async function main(argv: string[]): Promise<number> {
  const usage =
    "usage: node scripts/check-registry-snapshot.ts <dir> | --url <site> --generated-at <iso> [--all]";
  const all = argv.includes("--all");
  const urlAt = argv.indexOf("--url");
  const stampAt = argv.indexOf("--generated-at");
  let result: SnapshotCheck;
  try {
    if (urlAt >= 0) {
      const site = argv[urlAt + 1];
      const stamp = argv[stampAt + 1];
      if (!site || stampAt < 0 || !stamp) {
        console.error(usage);
        return 2;
      }
      result = await checkDeployedSnapshot(site, stamp, {
        sample: all ? undefined : DEPLOYED_SAMPLE,
        timeoutMs: 15 * 60_000,
        intervalMs: 30_000,
        log: (m) => console.log(m),
      });
    } else {
      const dir = argv.find((a) => !a.startsWith("--"));
      if (!dir) {
        console.error(usage);
        return 2;
      }
      result = checkRegistrySnapshot(resolve(dir));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const summary = `QA-06: registry/index.json is ${kb(result.indexGzipBytes)} gzipped`;
  for (const warning of result.warnings)
    console.log(`warning: ${warning.message}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n\n`);
  if (!reportProblems("registry snapshot", result.problems)) return 1;
  console.log(`${summary}, within the limit`);
  return 0;
}

if (isMain(import.meta)) process.exitCode = await main(process.argv.slice(2));
