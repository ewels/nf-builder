import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  initialJsFiles,
  type Manifest,
} from "../scripts/check-bundle-budget.ts";
import { REPO_ROOT, WEB_DIST } from "../scripts/check-common.ts";
import { readWorkerManifest } from "../scripts/worker-manifest.ts";
import { SMOKE_TAG } from "./browsers.ts";
import { watchForCspViolations } from "./csp.ts";
import { type EngineHook, parserChunks, readProject } from "./engine.ts";
import { scriptActivity } from "./trace.ts";

const PARSER_MARKER =
  "check for an unclosed brace, bracket, parenthesis, or string";
const TREE = join(REPO_ROOT, "tools/oracle/cases/f105-includes-resolve");

test("F-113 AR-04 QA-20 QA-30: the engine worker opens a project and applies an edit with no CSP violation or console error", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  const files = readProject(TREE);
  const target = "modules/local/a/main.nf";
  const text = files.find((f) => f.path === target)?.text ?? "";
  const result = await page.evaluate(
    async ({ files, target, text }) => {
      const engine = (window as unknown as { nfBuilderEngine: EngineHook })
        .nfBuilderEngine;
      const phases: string[] = [];
      const summary = await engine.open({ version: "26.10", files }, (p) => {
        phases.push(p.phase);
      });
      const applied = await engine.apply(
        { kind: "replaceFileText", path: target, text: `${text}\n// edited\n` },
        summary.revision,
      );
      return { phases, applied };
    },
    { files, target, text },
  );
  expect(result.phases).toContain("loading");
  expect(result.phases).toContain("parsing");
  expect(result.applied.ok).toBe(true);
  const remodelled = result.applied.remodelled ?? [];
  expect(remodelled).toContain(target);
  expect(remodelled).toContain("main.nf");
  expect(remodelled).not.toContain("conf/base.config");
  expect(remodelled.length).toBeLessThan(files.length / 2);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-113 step 2 QA-01 ADR-0033: the parser and the catalogue are built only into the worker", () => {
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  for (const [key, chunk] of Object.entries(manifest)) {
    expect(key).not.toMatch(/lang-2610\/src\/source\/index\.ts$/);
    expect((chunk as { src?: string }).src ?? key).not.toMatch(
      /catalogue\/(script|config)\.json$/,
    );
  }
  // F-011: serves the app under /nf-builder/; initialJsFiles then needs the base path to match the HTML's asset URLs
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = new Set(initialJsFiles(manifest, html));
  const worker = readWorkerManifest(WEB_DIST);
  const workerFiles = new Set(worker.map((c) => c.file));
  const parser = parserChunks();
  expect(parser.length).toBeGreaterThan(0);
  for (const f of readdirSync(join(WEB_DIST, "assets"))) {
    if (!f.endsWith(".js")) continue;
    const file = `assets/${f}`;
    const holdsParser = readFileSync(join(WEB_DIST, file), "utf8").includes(
      PARSER_MARKER,
    );
    if (holdsParser) {
      expect(workerFiles.has(file), file).toBe(true);
      expect(initial.has(file), file).toBe(false);
    }
  }
  expect(worker.some((c) => c.src?.endsWith(".json"))).toBe(true);
  const entry = worker.find((c) => c.isEntry);
  expect(entry?.dynamicImports.some((f) => parser.includes(f))).toBe(true);
});

test("F-113 step 2 AR-04: the main thread does no parsing (Chromium performance trace)", async ({
  page,
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "performance traces are Chromium only");
  await page.goto("./");
  const files = readProject(TREE);
  const main = files.find((f) => f.path === "main.nf")?.text ?? "";
  await browser.startTracing(page, {
    categories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "v8.execute",
      "v8",
      "toplevel",
      "disabled-by-default-v8.cpu_profiler",
    ],
  });
  const applied = await page.evaluate(
    async ({ files, main }) => {
      const engine = (window as unknown as { nfBuilderEngine: EngineHook })
        .nfBuilderEngine;
      const summary = await engine.open({ version: "26.10", files });
      const result = await engine.apply(
        {
          kind: "replaceFileText",
          path: "main.nf",
          text: `${main}\n// edited\n`,
        },
        summary.revision,
      );
      await engine.project("main.nf", null);
      return result.ok;
    },
    { files, main },
  );
  const trace = JSON.parse((await browser.stopTracing()).toString("utf8"));
  expect(applied).toBe(true);
  // every built script that holds the parser, wherever it was built, so a parser loaded on the main thread shows up
  const holders = readdirSync(join(WEB_DIST, "assets"))
    .filter((f) => f.endsWith(".js"))
    .filter((f) =>
      readFileSync(join(WEB_DIST, "assets", f), "utf8").includes(PARSER_MARKER),
    );
  expect(holders.length).toBeGreaterThan(0);
  const activity = scriptActivity(trace, (url) =>
    holders.some((file) => url.endsWith(`/assets/${file}`)),
  );
  // the main thread was profiled (a missing profile can't pass) and ran no parser code
  expect(activity.get("CrRendererMain")?.total).toBeGreaterThan(0);
  expect(activity.get("CrRendererMain")).toMatchObject({
    samples: 0,
    compiles: 0,
  });
  // positive control: the same analysis sees the parser run on the worker thread
  expect(activity.get("DedicatedWorker thread")?.samples).toBeGreaterThan(0);
});
