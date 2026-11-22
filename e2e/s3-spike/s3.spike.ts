import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  type Environment,
  type ReferenceResult,
  type RunMetrics,
  rendererMemoryMb,
  rendererPids,
  summarise,
  toMarkdown,
} from "./metrics.ts";
import {
  CACHE_DIR,
  EXPECTED_PATH,
  RESULTS_DIR,
  SPIKE_PORT,
  SPIKE_QA30_URL,
  SPIKE_URL,
} from "./paths.ts";
import {
  CHEERPJ_ORIGIN,
  DEFAULT_VARIANT,
  loaderUrl,
  parseVariant,
  type Variant,
  variantLabel,
  type WorkerStage,
} from "./protocol.ts";
import type { PageRun } from "./www/page.ts";

const CDN_HOST = new URL(CHEERPJ_ORIGIN).host;
const STAGES: WorkerStage[] = [
  "workerStarted",
  "loaderLoaded",
  "cheerpjReady",
  "libraryLoaded",
  "serverStarted",
];

test("F-007 step 1 ADR-0010: the test page sends initialize and textDocument/didOpen to language-server-all.jar under CheerpJ in a Web Worker and receives the known diagnostic", async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const workers: string[] = [];
  const hosts = new Set<string>();
  const pageErrors: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(SPIKE_URL);

  const run: PageRun = await page.evaluate(
    ([variant]) =>
      window.s3Spike.run(variant as never, { edits: 1, timeoutMs: 240_000 }),
    [DEFAULT_VARIANT],
  );
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, "utf8"));

  expect(run.error).toBeNull();
  expect(run.session?.sent.slice(0, 3)).toEqual([
    "initialize",
    "initialized",
    "textDocument/didOpen",
  ]);
  expect(run.session?.initializeResult.capabilities.textDocumentSync).toBe(2);
  expect(run.session?.firstDiagnostics).toEqual(expected.diagnostics);
  expect(workers).toHaveLength(1);
  expect(run.marks.libraryLoaded).toBeDefined();
  expect(await page.evaluate(() => "cheerpjInit" in window)).toBe(false);
  expect(run.cspViolations).toEqual([]);
  expect([...hosts].sort()).toEqual(
    [`localhost:${SPIKE_PORT}`, new URL(CHEERPJ_ORIGIN).host].sort(),
  );
  expect(pageErrors).toEqual([]);
  await context.close();
});

function runInPage(
  page: Page,
  variant: Variant,
  options: {
    edits: number;
    timeoutMs: number;
    preloadResources?: Record<string, number[]>;
  },
): Promise<PageRun> {
  return page.evaluate(
    ([v, o]) => window.s3Spike.run(v as never, o as never),
    [variant, options],
  );
}

function loaderSha256(): string {
  const result = spawnSync("curl", [
    "-fsSL",
    "--retry",
    "3",
    loaderUrl(DEFAULT_VARIANT),
  ]);
  return result.status === 0
    ? createHash("sha256").update(result.stdout).digest("hex")
    : "unavailable";
}

function environment(browser: Browser): Environment {
  return {
    date: new Date().toISOString().slice(0, 10),
    chromium: `Chromium ${browser.version()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    proxy: Boolean(process.env.HTTPS_PROXY),
    loaderSha256: loaderSha256(),
  };
}

function readJson<T>(file: string): T | undefined {
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as T)
    : undefined;
}

type Failure = { variant: string; kind: "cold" | "warm"; error: string };
type E2Results = {
  environment: Environment;
  runs: RunMetrics[];
  /** A variant that fails to start is recorded, not debugged (the plan's T7 rule). */
  failures: Failure[];
};
type E3Results = {
  completed: boolean;
  error: string | null;
  lastStage: WorkerStage | null;
  cspViolations: string[];
};

/** summarise() needs a cold run per variant; a variant that failed before its first one has none. */
function hasColdRun(runs: readonly RunMetrics[]): (run: RunMetrics) => boolean {
  const cold = new Set(
    runs.filter((r) => r.kind === "cold").map((r) => r.variant),
  );
  return (run) => cold.has(run.variant);
}

/** latest.json and latest.md combine the newest E2 and E3 results (either test may run alone). */
function writeLatest(): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const e2 = readJson<E2Results>(join(RESULTS_DIR, "e2.json"));
  const e3 = readJson<E3Results>(join(RESULTS_DIR, "e3.json"));
  const reference = readJson<ReferenceResult>(
    join(CACHE_DIR, "reference.json"),
  );
  const summaries = e2 ? summarise(e2.runs.filter(hasColdRun(e2.runs))) : [];
  let md = e2
    ? toMarkdown(summaries, e2.environment, reference)
    : "# Spike S3 results\n";
  if (e2 && e2.failures.length > 0) {
    md += [
      "",
      "## Variants that failed",
      "",
      ...e2.failures.map((f) => `- ${f.variant} (${f.kind} run): ${f.error}`),
      "",
    ].join("\n");
  }
  if (e3) {
    md += [
      "",
      "## Strictest QA-30 policy (CheerpJ CDN and 'wasm-unsafe-eval', no 'unsafe-eval')",
      "",
      `- Session completed: ${e3.completed ? "yes" : "no"}`,
      `- Last worker stage reached: ${e3.lastStage ?? "none"}`,
      `- Error: ${e3.error ?? "none"}`,
      `- CSP violations: ${e3.cspViolations.length === 0 ? "none" : e3.cspViolations.join("; ")}`,
      "",
    ].join("\n");
  }
  writeFileSync(
    join(RESULTS_DIR, "latest.json"),
    `${JSON.stringify({ e2, summaries, reference, e3 }, null, 2)}\n`,
  );
  writeFileSync(join(RESULTS_DIR, "latest.md"), md);
  return md;
}

function metricsOf(
  variant: Variant,
  kind: "cold" | "warm",
  run: PageRun,
  extra: Partial<RunMetrics>,
): RunMetrics {
  if (run.error !== null || run.session === null)
    throw new Error(
      `${variantLabel(variant)} ${kind} run failed: ${run.error}`,
    );
  const s = run.session;
  return {
    variant: variantLabel(variant),
    kind,
    coldStartMs: s.initializeResponseAt - run.workerCreatedAt,
    firstDiagnosticsMs: s.firstDiagnosticsAt - s.didOpenSentAt,
    editDiagnosticsMs: s.edits.map((e) => e.diagnosticsAt - e.sentAt),
    baselineRssMb: null,
    peakRssMb: null,
    longTaskMaxMs: run.longTasks.maxMs,
    requests: { cdn: 0, app: 0 },
    bytes: { cdn: 0, jar: 0 },
    ...extra,
  };
}

/** Counts requests and response body bytes (page and worker) until `done()` is called. */
function watchRequests(page: Page) {
  const counts = { cdn: 0, app: 0 };
  const bytes = { cdn: 0, jar: 0 };
  const pending: Promise<void>[] = [];
  page.on("requestfinished", (request) => {
    const url = new URL(request.url());
    const cdn = url.host === CDN_HOST;
    counts[cdn ? "cdn" : "app"]++;
    pending.push(
      request.sizes().then((sizes) => {
        if (cdn) bytes.cdn += sizes.responseBodySize;
        else if (url.pathname.endsWith("language-server-all.jar"))
          bytes.jar += sizes.responseBodySize;
      }),
    );
  });
  return {
    async done() {
      await Promise.all(pending);
      return { requests: { ...counts }, bytes: { ...bytes } };
    },
  };
}

test("F-007 step 2 ADR-0010: cold and warm runs record cold start, peak memory and diagnostics time for each variant", async ({
  browser,
}) => {
  test.setTimeout(60 * 60_000);
  const variants = (process.env.S3_VARIANTS ?? "java=17")
    .split(";")
    .map(parseVariant);
  const runsPerVariant = Number(process.env.S3_RUNS ?? 3);
  const runs: RunMetrics[] = [];
  const failures: Failure[] = [];

  for (const variant of variants) {
    const preloadFile = join(CACHE_DIR, `preload-java${variant.java}.json`);
    const preloadResources = variant.preload
      ? readJson<Record<string, number[]>>(preloadFile)
      : undefined;
    if (variant.preload && !preloadResources)
      throw new Error(
        `${variantLabel(variant)} needs ${preloadFile}: run a variant without preload for Java ${variant.java} first`,
      );
    const options = {
      edits: 5,
      timeoutMs: 300_000,
      ...(preloadResources ? { preloadResources } : {}),
    };

    for (let i = 0; i < runsPerVariant; i++) {
      // Cold: a new context has an empty HTTP cache, and a new renderer.
      const context = await browser.newContext();
      const before = new Set(rendererPids());
      let page = await context.newPage();
      const requests = watchRequests(page);
      await page.goto(SPIKE_URL);
      let pid: number | undefined;
      for (let wait = 0; wait < 50 && pid === undefined; wait++) {
        pid = rendererPids().find((p) => !before.has(p));
        if (pid === undefined) await page.waitForTimeout(100);
      }
      if (pid === undefined) throw new Error("no new renderer process found");
      const baseline = rendererMemoryMb(pid).rssMb;
      const cold = await runInPage(page, variant, options);
      const peak = rendererMemoryMb(pid).peakMb;
      if (!variant.preload && cold.runtimeResources) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(preloadFile, cold.runtimeResources);
      }
      if (cold.error !== null || cold.session === null) {
        failures.push({
          variant: variantLabel(variant),
          kind: "cold",
          error: cold.error ?? "no session",
        });
        await context.close();
        break;
      }
      runs.push(
        metricsOf(variant, "cold", cold, {
          baselineRssMb: baseline,
          peakRssMb: peak,
          ...(await requests.done()),
        }),
      );

      // Warm: a new page in the same context, so the HTTP cache is warm.
      await page.close();
      page = await context.newPage();
      await page.goto(SPIKE_URL);
      const warm = await runInPage(page, variant, options);
      await context.close();
      if (warm.error !== null || warm.session === null) {
        failures.push({
          variant: variantLabel(variant),
          kind: "warm",
          error: warm.error ?? "no session",
        });
        break;
      }
      runs.push(metricsOf(variant, "warm", warm, {}));
    }
  }

  const results: E2Results = {
    environment: environment(browser),
    runs,
    failures,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    join(RESULTS_DIR, "e2.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  writeFileSync(
    join(RESULTS_DIR, `${stamp}.json`),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  const md = writeLatest();
  await test
    .info()
    .attach("latest.md", { body: md, contentType: "text/markdown" });

  expect(runs.some((r) => r.kind === "cold")).toBe(true);
  for (const r of runs) {
    expect(r.coldStartMs, `${r.variant} ${r.kind} cold start`).toBeGreaterThan(
      0,
    );
    expect(r.firstDiagnosticsMs).toBeGreaterThan(0);
    expect(r.editDiagnosticsMs).toHaveLength(5);
    if (r.kind === "cold") {
      expect(r.baselineRssMb).toBeGreaterThan(0);
      expect(r.peakRssMb).toBeGreaterThan(r.baselineRssMb ?? 0);
    }
  }
  expect(existsSync(join(RESULTS_DIR, "latest.md"))).toBe(true);
});

test("F-007 step 2 ADR-0014: record whether CheerpJ runs under the strictest CSP QA-30 allows (CheerpJ CDN and 'wasm-unsafe-eval', no 'unsafe-eval')", async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(SPIKE_QA30_URL);
  const run = await runInPage(page, DEFAULT_VARIANT, {
    edits: 0,
    timeoutMs: 120_000,
  });
  const reached = STAGES.filter((stage) => run.marks[stage] !== undefined);
  const results: E3Results = {
    completed: run.session !== null,
    error: run.error,
    lastStage: reached.at(-1) ?? null,
    cspViolations: run.cspViolations,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    join(RESULTS_DIR, "e3.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  const md = writeLatest();
  await test
    .info()
    .attach("latest.md", { body: md, contentType: "text/markdown" });
  expect(
    results.completed ||
      results.error !== null ||
      results.cspViolations.length > 0,
  ).toBe(true);
  await context.close();
});
