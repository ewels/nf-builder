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
export type SnapshotCheck = {
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

/** Checks the snapshot's index, ports, bundles and plugin files, read through `read` (a path or undefined). */
function checkContents(
  read: (path: string) => string | undefined,
  budget: Budget,
  where: string,
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

  const needed = new Set<string>();
  for (const m of (index.modules ?? []) as {
    name: string;
    version: string;
  }[]) {
    if (ports && !(m.name in portsByName))
      fail(`registry/ports.json has no ports for ${m.name}`);
    const path = bundlePath(m.name, m.version);
    needed.add(path);
  }
  const seen = new Set<string>();
  const queue = [...needed];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (seen.has(path)) continue;
    seen.add(path);
    const bundle = parse(path);
    if (!bundle) continue;
    if (bundle.format !== 1)
      fail(`${path} has format ${String(bundle.format)}, expected 1`);
    if (path !== bundlePath(String(bundle.name), String(bundle.version)))
      fail(`${path} holds ${String(bundle.name)}@${String(bundle.version)}`);
    for (const pin of (bundle.requires ?? []) as {
      name: string;
      version: string;
    }[])
      queue.push(bundlePath(pin.name, pin.version));
  }
  for (const p of (index.plugins ?? []) as { id: string; version: string }[]) {
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

export function checkRegistrySnapshot(
  dir: string,
  budget: Budget = readBudget("QA-06"),
): SnapshotCheck {
  const read = (path: string): string | undefined => {
    const file = join(dir, path);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  };
  return checkContents(read, budget, dir);
}

export type DeployedOptions = {
  timeoutMs: number;
  intervalMs: number;
  log?: (message: string) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Polls `<site>/registry/index.json` until it is JSON with this `generatedAt` (the SPA fallback answers a missing file with
 * HTML and status 200), then checks the served snapshot: the index, ports, and every module bundle and plugin file.
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
      const response = await doFetch(`${base}/${path}`);
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
  for (;;) {
    if (served(await get("registry/index.json"))) break;
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
  }
  // Fetch every file the snapshot names, then run the same content checks on the copies.
  const cache = new Map<string, string>();
  const index = JSON.parse(
    (await get("registry/index.json")) as string,
  ) as Json;
  const paths = ["registry/index.json", "registry/ports.json"];
  for (const m of (index.modules ?? []) as { name: string; version: string }[])
    paths.push(bundlePath(m.name, m.version));
  for (const p of (index.plugins ?? []) as { id: string; version: string }[])
    paths.push(pluginPath(p.id, p.version));
  for (const path of paths) {
    const text = await get(path);
    if (text !== undefined) cache.set(path, text);
    // Pinned versions come with the bundles; fetch them as they are named.
    if (text !== undefined && path.startsWith("registry/modules/"))
      for (const pin of ((JSON.parse(text) as Json).requires ?? []) as {
        name: string;
        version: string;
      }[]) {
        const pinPath = bundlePath(pin.name, pin.version);
        if (!paths.includes(pinPath)) paths.push(pinPath);
      }
  }
  return checkContents((path) => cache.get(path), readBudget("QA-06"), base);
}

async function main(argv: string[]): Promise<number> {
  const usage =
    "usage: node scripts/check-registry-snapshot.ts <dir> | --url <site> --generated-at <iso>";
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
