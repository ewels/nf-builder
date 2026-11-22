import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { openProbe, PROBE_TITLE, runInPage } from "./page.ts";
import {
  type BrowserResult,
  classify,
  matchTemplate,
  openApiGetPaths,
  type ProbeRecord,
  type ProbeRun,
  probeOrigin,
  toMarkdown,
} from "./report.ts";
import { probeServer } from "./server.ts";
import { S4_TARGETS } from "./targets.ts";

const BASE = probeOrigin(process.env.S4_PROBE_URL);
const REGISTRY = "https://registry.nextflow.io";

function summary(markdown: string) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

test.describe("F-008 S4 probe against the deployed site", () => {
  // Measure CORS, not our own CSP (ADR 0023).
  test.use({ bypassCSP: true });

  test("F-008 step 1 ADR-0009: the deployed probe page records status, CORS headers and timing for every registry, raw.githubusercontent.com and codeload.github.com target", async ({
    page,
    request,
    browser,
    browserName,
  }, testInfo) => {
    // Console and failed-request messages, keyed by the target they belong to.
    const messages = new Map<string, string[]>();
    const note = (url: string, text: string) => {
      for (const target of S4_TARGETS) {
        if (url.startsWith(target.url.split("?")[0] ?? target.url)) {
          messages.set(target.id, [...(messages.get(target.id) ?? []), text]);
        }
      }
    };
    page.on("console", (m) => {
      const text = m.text();
      for (const target of S4_TARGETS) {
        if (text.includes(new URL(target.url).origin)) {
          messages.set(target.id, [
            ...(messages.get(target.id) ?? []),
            `${m.type()}: ${text}`,
          ]);
        }
      }
    });
    page.on("requestfailed", (r) =>
      note(r.url(), `requestfailed: ${r.failure()?.errorText ?? "unknown"}`),
    );

    const versionResponse = await request.get(`${BASE}/version.json`, {
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

    await openProbe(page, BASE);
    await expect(page).toHaveTitle(PROBE_TITLE);
    const browserResults = await runInPage(page, S4_TARGETS);
    expect(browserResults).toHaveLength(S4_TARGETS.length);

    const records: ProbeRecord[] = [];
    for (const [i, target] of S4_TARGETS.entries()) {
      const result = browserResults[i] as BrowserResult;
      expect(result.id).toBe(target.id);
      const server = await probeServer(request, target.url, BASE);
      const { verdict, reason } = classify(result, server);
      records.push({
        target,
        browser: result,
        browserMessages: messages.get(target.id) ?? [],
        server,
        verdict,
        reason,
      });
    }

    const run: ProbeRun = {
      probedAt: new Date().toISOString(),
      pageUrl: `${BASE}/spike/s4/`,
      deployed: version?.commit
        ? { commit: version.commit, context: version.context ?? "unknown" }
        : null,
      browserName,
      browserVersion: browser.version(),
      environment: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
      records,
    };
    const markdown = toMarkdown(run);
    const jsonPath = testInfo.outputPath("s4-probe.json");
    const mdPath = testInfo.outputPath("s4-probe.md");
    writeFileSync(jsonPath, `${JSON.stringify(run, null, 2)}\n`);
    writeFileSync(mdPath, markdown);
    await testInfo.attach("s4-probe.json", {
      path: jsonPath,
      contentType: "application/json",
    });
    await testInfo.attach("s4-probe.md", {
      path: mdPath,
      contentType: "text/markdown",
    });
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
      // The bypass worked: our own CSP must never be what blocks a target.
      expect(record.verdict, record.target.id).not.toBe("blocked-by-csp");
    }
    const control = records.find((r) => r.target.id === "raw-pipeline-file");
    expect(control?.verdict).toBe("allowed");
    expect(control?.browser.status).toBe(200);
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
    const path = testInfo.outputPath("openapi.json");
    writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach("openapi.json", {
      path,
      contentType: "application/json",
    });
    summary(
      `## S4 OpenAPI check\n\nRegistry OpenAPI ${version} (sha256 ${evidence.sha256}), ${matches.length} endpoints matched.\n`,
    );
  });
});
