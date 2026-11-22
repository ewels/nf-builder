import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { expect, type TestInfo, test } from "@playwright/test";
import { openProbe, PROBE_PATH, PROBE_TITLE, runInPage } from "./page.ts";
import {
  type BrowserResult,
  classify,
  matchTemplate,
  openApiGetPaths,
  type ProbeRecord,
  type ProbeRun,
  probeSite,
  stripPolicyMeta,
  toMarkdown,
} from "./report.ts";
import { probeServer } from "./server.ts";
import { S4_TARGETS } from "./targets.ts";

const SITE = probeSite(process.env.S4_PROBE_URL);
const REGISTRY = "https://registry.nextflow.io";

function summary(markdown: string) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

async function save(
  testInfo: TestInfo,
  name: string,
  text: string,
  contentType: string,
) {
  const path = testInfo.outputPath(name);
  writeFileSync(path, text);
  await testInfo.attach(name, { path, contentType });
}

test.describe("F-008 S4 probe against the deployed site", () => {
  test("F-008 step 1 ADR-0009: the deployed probe page records status, CORS headers and timing for every registry, raw.githubusercontent.com and codeload.github.com target", async ({
    page,
    request,
    browser,
    browserName,
  }, testInfo) => {
    // Measure CORS, not our own CSP (ADR 0023, 0040): drop the CSP <meta> from the probe document only.
    // The page keeps its origin, and this works the same in every engine (bypassCSP does not lift connect-src in WebKit).
    await page.route(`${SITE.url}${PROBE_PATH}`, async (route) => {
      const response = await route.fetch();
      const { "content-length": _length, ...headers } = response.headers();
      await route.fulfill({
        response,
        headers,
        body: stripPolicyMeta(await response.text()),
      });
    });

    // Targets are probed one at a time, so console and failed-request messages belong to the target in flight.
    const messages = new Map<string, string[]>(
      S4_TARGETS.map((t) => [t.id, []]),
    );
    let inFlight = "";
    page.on("console", (m) =>
      messages.get(inFlight)?.push(`${m.type()}: ${m.text()}`),
    );
    page.on("requestfailed", (r) =>
      messages
        .get(inFlight)
        ?.push(
          `requestfailed: ${r.failure()?.errorText ?? "unknown"} ${r.url()}`,
        ),
    );

    const versionResponse = await request.get(`${SITE.url}version.json`, {
      headers: { "Cache-Control": "no-store" },
    });
    const version = (await versionResponse.json().catch(() => null)) as {
      commit?: string;
      context?: string;
    } | null;
    expect(typeof version?.commit, "version.json has a commit").toBe("string");
    if (process.env.S4_EXPECTED_COMMIT) {
      expect(version?.commit).toBe(process.env.S4_EXPECTED_COMMIT);
    }

    await openProbe(page);
    await expect(page).toHaveTitle(PROBE_TITLE);
    const records: ProbeRecord[] = [];
    for (const target of S4_TARGETS) {
      inFlight = target.id;
      const [result] = await runInPage(page, [target]);
      expect(result?.id).toBe(target.id);
      const browserResult = result as BrowserResult;
      const server = await probeServer(request, target.url, SITE.origin);
      const { verdict, reason } = classify(browserResult, server);
      records.push({
        target,
        browser: browserResult,
        browserMessages: messages.get(target.id) ?? [],
        server,
        verdict,
        reason,
      });
    }
    inFlight = "";

    const run: ProbeRun = {
      probedAt: new Date().toISOString(),
      pageUrl: `${SITE.url}${PROBE_PATH}`,
      deployed: version?.commit
        ? { commit: version.commit, context: version.context ?? "unknown" }
        : null,
      browserName,
      browserVersion: browser.version(),
      environment: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
      records,
    };
    const markdown = toMarkdown(run);
    await save(
      testInfo,
      "s4-probe.json",
      `${JSON.stringify(run, null, 2)}\n`,
      "application/json",
    );
    await save(testInfo, "s4-probe.md", markdown, "text/markdown");
    await testInfo.attach("probe-table", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    summary(markdown);

    for (const record of records) {
      expect(Number.isFinite(record.browser.durationMs), record.target.id).toBe(
        true,
      );
      expect(
        ["readable", "failed", "timeout", "csp-blocked"],
        record.target.id,
      ).toContain(record.browser.outcome);
      const first = record.server.hops[0];
      if (first) {
        expect(typeof first.status, record.target.id).toBe("number");
        expect(first.sentOrigin, record.target.id).toBeTruthy();
      } else {
        expect(record.server.error, record.target.id).toBeTruthy();
      }
      expect(
        "status" in record.server.preflight ||
          "error" in record.server.preflight,
        record.target.id,
      ).toBe(true);
      // The CSP strip worked: our own CSP must never be what blocks a target.
      expect(record.verdict, record.target.id).not.toBe("blocked-by-csp");
    }
    const control = records.find((r) => r.target.id === "raw-pipeline-file");
    expect(control?.verdict).toBe("allowed");
    expect(control?.browser.status).toBe(200);
    // A readable target carries no CORS error from another target.
    expect(
      control?.browserMessages.filter((m) => /cors|blocked/i.test(m)),
    ).toEqual([]);
    // Negative control: github.com sends no CORS headers.
    expect(
      records.find((r) => r.target.id === "github-archive")?.verdict,
    ).not.toBe("allowed");
  });

  test("F-008 step 2 ADR-0009 @openapi: every registry endpoint the probe calls is a GET operation in the live OpenAPI document at registry.nextflow.io/openapi/", async ({
    request,
  }, testInfo) => {
    const versionsResponse = await request.get(
      `${REGISTRY}/openapi/versions.txt`,
    );
    expect(versionsResponse.status()).toBe(200);
    const versions = (await versionsResponse.text()).trim();
    expect(versions).not.toBe("");

    const yamlResponse = await request.get(
      `${REGISTRY}/openapi/openapi-latest.yaml`,
    );
    expect(yamlResponse.status()).toBe(200);
    const body = await yamlResponse.body();
    const { version, paths } = openApiGetPaths(body.toString("utf8"));
    expect(version, "info.version").toBeTruthy();

    const matches = S4_TARGETS.filter((t) => t.group === "registry").map(
      (target) => {
        const declared = target.openapi;
        const found = matchTemplate(paths, new URL(target.url).pathname);
        expect(declared, target.id).toBeDefined();
        expect(paths.has(declared?.template ?? ""), target.id).toBe(true);
        expect(paths.get(declared?.template ?? "")?.get("get"), target.id).toBe(
          declared?.operationId,
        );
        expect(found, target.id).toEqual(declared);
        return { id: target.id, ...found };
      },
    );
    const evidence = {
      fetchedAt: new Date().toISOString(),
      version,
      sha256: createHash("sha256").update(body).digest("hex"),
      versions: versions.split(/\s+/),
      matches,
    };
    await save(
      testInfo,
      "openapi.json",
      `${JSON.stringify(evidence, null, 2)}\n`,
      "application/json",
    );
    summary(
      `## S4 OpenAPI check\n\nRegistry OpenAPI ${version} (sha256 ${evidence.sha256}), ${matches.length} endpoints matched.\n`,
    );
  });
});
