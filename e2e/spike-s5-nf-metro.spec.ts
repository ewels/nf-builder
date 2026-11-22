import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import {
  cspProblems,
  SITE_POLICY_HEADERS,
} from "../scripts/security-policy.ts";
import { spikeS5Headers } from "../spikes/s5-nf-metro/headers.ts";
import { SPIKE_S5_CACHE } from "../spikes/s5-nf-metro/prepare.ts";
import { SPIKE_S5_URL, startSpikeS5 } from "../spikes/s5-nf-metro/serve.ts";
import { MISMATCH_TOLERANCE } from "../spikes/s5-nf-metro/src/compare.ts";
import {
  MAPS,
  type SpikeMetrics,
  WHEELS,
} from "../spikes/s5-nf-metro/src/protocol.ts";
import { watchForCspViolations } from "./csp.ts";

// Spike S5 (F-010, ADR 0024). Chromium only and not @smoke: the beforeAll never runs in the smoke, Firefox or WebKit runs.
const CSP = "Content-Security-Policy";

async function loadMetrics(page: Page): Promise<SpikeMetrics> {
  await page.goto(SPIKE_S5_URL);
  await expect(page.locator("#status")).toHaveText("Done", {
    timeout: 120_000,
  });
  return JSON.parse(
    (await page.locator("#metrics").textContent()) ?? "",
  ) as SpikeMetrics;
}

let server: Awaited<ReturnType<typeof startSpikeS5>> | undefined;

test.describe("F-010 spike S5: nf-metro under Pyodide", () => {
  test.beforeAll(async () => {
    test.setTimeout(600_000);
    server = await startSpikeS5();
  });
  test.afterAll(async () => {
    await server?.close();
  });

  test("F-010 step 1 ADR-0013 FI-54: the test page renders the nf-core rnaseq and sarek example maps to SVG in a Web Worker under Pyodide, without av or resvg-py", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const watch = await watchForCspViolations(page);
    const urls: string[] = [];
    context.on("request", (request) => urls.push(request.url()));
    const metrics = await loadMetrics(page);

    for (const map of MAPS) {
      const image = page.getByRole("img", {
        name: `${map.title} metro map, rendered in the browser`,
      });
      await expect(image).toBeVisible();
      expect(
        await image.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
    }

    expect(metrics.pyodideVersion).toBe("314.0.8");
    expect(metrics.nfMetroVersion).toBe("2.1.0");
    expect(metrics.maps.map((m) => m.name)).toEqual(MAPS.map((m) => m.name));
    for (const map of metrics.maps) expect(map.svgBytes).toBeGreaterThan(0);

    const workerPaths = metrics.workerResources.map((r) => r.path);
    expect(workerPaths).toContain("/pyodide/pyodide.asm.wasm");
    for (const wheel of WHEELS)
      expect(workerPaths).toContain(`/wheels/${wheel}`);
    expect(metrics.loadedModules).toContain("nf_metro");
    expect(metrics.loadedModules).toContain("PIL");
    for (const name of ["av", "resvg_py", "click"])
      expect(metrics.loadedModules).not.toContain(name);

    expect(urls.filter((url) => /av-|resvg/.test(url))).toEqual([]);
    expect(metrics.workerCspViolations).toEqual([]);
    expect(await watch.violations()).toEqual([]);
    expect(watch.consoleErrors).toEqual([]);
  });

  test("F-010 step 2 ADR-0013: each browser-rendered SVG matches the nf-metro 2.1.0 CLI output for the same input within the pixel tolerance", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const metrics = await loadMetrics(page);
    expect(metrics.referenceNfMetro).toBe("2.1.0");
    expect(metrics.nfMetroVersion).toBe("2.1.0");
    expect(metrics.maps).toHaveLength(MAPS.length);
    for (const map of metrics.maps) {
      expect(map.sameSize, map.name).toBe(true);
      expect(map.mismatchRatio, map.name).toBeLessThanOrEqual(
        MISMATCH_TOLERANCE,
      );
      expect(map.width, map.name).toBeGreaterThan(0);
      expect(map.height, map.name).toBeGreaterThan(0);
      // Text identity is recorded, not asserted: harmless attribute reordering in a later version must not fail the spike.
      test.info().annotations.push({
        type: `textIdentical ${map.name}`,
        description: String(map.textIdentical),
      });
      console.log(
        `F-010 compare ${map.name}: ${map.width}x${map.height}, ${map.mismatchPixels} differing pixels (${(map.mismatchRatio * 100).toFixed(4)}%), text identical ${map.textIdentical}`,
      );
    }
  });

  test("F-010 step 3 ADR-0013: a cold load records the download size and first-render time, with every request to the page's own origin", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests: { path: string; bodyBytes: number }[] = [];
    const urls: string[] = [];
    const sizes: Promise<void>[] = [];
    // Every request, finished or not, so a blocked or failed off-origin request is caught too.
    context.on("request", (request) => urls.push(request.url()));
    context.on("requestfinished", (request) => {
      sizes.push(
        request.sizes().then((size) => {
          requests.push({
            path: new URL(request.url()).pathname,
            bodyBytes: size.responseBodySize,
          });
        }),
      );
    });
    const metrics = await loadMetrics(page);
    await Promise.all(sizes);
    await context.close();

    for (const url of urls)
      expect(url.startsWith(SPIKE_S5_URL) || url.startsWith("blob:"), url).toBe(
        true,
      );

    const decoded = new Map(
      metrics.workerResources.map((r) => [r.path, r.decodedBodySize]),
    );
    const dist = join(SPIKE_S5_CACHE, "dist");
    const rows = requests
      .filter((r) => r.path !== "/")
      .map((r) => {
        let gzipBytes = 0;
        try {
          gzipBytes = gzipSync(readFileSync(join(dist, r.path))).length;
        } catch {
          // Not a file in dist (for example a worker script served from /assets): counted as served only.
        }
        return {
          path: r.path,
          bodyBytes: r.bodyBytes,
          decodedBytes: decoded.get(r.path) ?? r.bodyBytes,
          gzipBytes,
        };
      })
      .sort((a, b) => b.bodyBytes - a.bodyBytes);
    const totals = {
      bodyBytes: rows.reduce((sum, r) => sum + r.bodyBytes, 0),
      decodedBytes: rows.reduce((sum, r) => sum + r.decodedBytes, 0),
      gzipBytes: rows.reduce((sum, r) => sum + (r.gzipBytes || r.bodyBytes), 0),
    };
    expect(totals.bodyBytes).toBeGreaterThan(10_000_000);
    expect(metrics.firstRenderMs).toBeGreaterThan(0);
    expect(metrics.firstRenderMs).toBeLessThan(120_000);

    const report = { metrics, requests: rows, totals };
    const directory = join(SPIKE_S5_CACHE, "metrics");
    mkdirSync(directory, { recursive: true });
    const file = join(
      directory,
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${testInfo.repeatEachIndex}.json`,
    );
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    await testInfo.attach("spike-s5-metrics.json", {
      path: file,
      contentType: "application/json",
    });
    const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
    const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
    const render = (name: string) =>
      s(metrics.maps.find((m) => m.name === name)?.renderMs ?? 0);
    console.log(
      `F-010 metrics: ${mb(totals.bodyBytes)} served (${mb(totals.decodedBytes)} decoded, ${mb(totals.gzipBytes)} gzip), first render ${s(metrics.firstRenderMs)} (runtime ${s(metrics.phases.runtimeMs)}, install ${s(metrics.phases.installMs)}, import ${s(metrics.phases.importMs)}, rnaseq ${render("rnaseq_metro")}, sarek ${render("sarek_metro")})`,
    );
  });

  test("F-010 QA-30 ADR-0014 ADR-0002: the spike page and its worker are served with the site policy (SITE_POLICY_HEADERS) plus only 'wasm-unsafe-eval', and nothing violates it", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const watch = await watchForCspViolations(page);
    const metrics = await loadMetrics(page);
    const expected = spikeS5Headers()[CSP] ?? "";
    const netlify = SITE_POLICY_HEADERS[CSP] ?? "";
    expect(expected).toBe(
      netlify.replace(
        "script-src 'self';",
        "script-src 'self' 'wasm-unsafe-eval';",
      ),
    );
    expect(expected).not.toBe(netlify);
    expect(cspProblems(expected)).toEqual([]);

    const worker = page.workers()[0];
    expect(worker).toBeDefined();
    for (const url of [SPIKE_S5_URL, worker?.url() ?? ""]) {
      const response = await request.get(url);
      expect(response.headers()["content-security-policy"], url).toBe(expected);
    }
    expect(metrics.workerCspViolations).toEqual([]);
    expect(await watch.violations()).toEqual([]);
    expect(watch.consoleErrors).toEqual([]);
  });
});
