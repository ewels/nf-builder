import { expect, test } from "@playwright/test";
import { readNetlifyConfig, siteHeaders } from "../scripts/netlify-config.ts";
import { watchForCspViolations } from "./csp.ts";
import { openProbe, PROBE_TITLE, runInPage } from "./s4-probe/page.ts";
import { S4_TARGETS } from "./s4-probe/targets.ts";

const expectedHeaders = siteHeaders(readNetlifyConfig());

test("F-008 ADR-0009: the S4 probe page loads under the site CSP with no violations and records status, response type and timing for a same-origin target", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  const response = await openProbe(page);
  expect(response?.headers()["content-security-policy"]).toBe(
    expectedHeaders["Content-Security-Policy"],
  );
  await expect(page).toHaveTitle(PROBE_TITLE);
  const results = await runInPage(page, [{ id: "self", url: "/version.json" }]);
  expect(results).toHaveLength(1);
  const [result] = results;
  expect(result).toMatchObject({
    id: "self",
    outcome: "readable",
    status: 200,
    responseType: "basic",
  });
  expect(Number.isFinite(result?.durationMs)).toBe(true);
  expect(result?.durationMs).toBeGreaterThanOrEqual(0);
  expect(result?.bytes).toBeGreaterThan(0);
  const rows = page.locator("#probe-results tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("self");
  await expect(rows.first()).toContainText("readable");
  await expect(page.locator('body[data-state="done"]')).toBeVisible();
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-008 QA-30: under the site CSP the probe page reports github.com as blocked by CSP", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await openProbe(page);
  const target = S4_TARGETS.find((t) => t.id === "github-archive");
  if (!target) throw new Error("github-archive target missing");
  const [result] = await runInPage(page, [{ id: target.id, url: target.url }]);
  expect(result).toMatchObject({
    outcome: "csp-blocked",
    cspDirective: "connect-src",
  });
  expect(await watch.violations()).toContain(
    "connect-src https://github.com/nf-core/fetchngs/archive/refs/tags/1.13.0.zip",
  );
});
