import {
  expect,
  type FrameLocator,
  type Locator,
  type Page,
  type Route,
  test,
} from "@playwright/test";
import { watchForCspViolations } from "./csp.ts";
import { PREVIEW_URL } from "./urls.ts";

const REGISTRY_HOST = "registry.nextflow.io";
const REGISTRY_ROUTE = `https://${REGISTRY_HOST}/**`;
/** The fixture snapshot was built at 2026-11-22T00:00:00Z. */
const FIXED_NOW = new Date("2026-11-22T05:00:00Z");

declare global {
  interface Window {
    nfBuilderRegistry?: { reload(options: { live: boolean }): Promise<void> };
  }
}

const registry = (scope: Page | FrameLocator): Locator =>
  scope.getByRole("region", { name: REGISTRY_HOST });
const sourceLine = (scope: Page | FrameLocator): Locator =>
  registry(scope).locator(".registry-source");
const refreshButton = (scope: Page | FrameLocator): Locator =>
  registry(scope).getByRole("button", { name: "Refresh registry data" });
/** Module rows carry the full name in data-name; the visible label is the short name (F-503). */
const moduleRows = (scope: Page | FrameLocator): Locator =>
  registry(scope).locator("#registry-modules [data-name]");
const moduleNames = (scope: Page | FrameLocator): Promise<string[]> =>
  moduleRows(scope).evaluateAll((rows) =>
    rows.map((r) => r.getAttribute("data-name") ?? ""),
  );

/** Console errors with the URL Chromium attributes them to: a failed fetch may not name it in its text. */
function watchConsole(page: Page) {
  const errors: { text: string; url: string }[] = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push({ text: message.text(), url: message.location().url });
  });
  page.on("pageerror", (error) => {
    errors.push({ text: error.message, url: "" });
  });
  return errors;
}

const fromRegistry = (e: { text: string; url: string }) =>
  e.url.includes(REGISTRY_HOST) || e.text.includes(REGISTRY_HOST);

function trackRegistryRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(REGISTRY_HOST)) urls.push(request.url());
  });
  return urls;
}

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  });

const LIVE_MODULE = (name: string, kind: string, revoked = false) => ({
  id: name,
  name,
  revoked,
  description: `${name} from the live registry`,
  kind,
});

async function routeLiveRegistry(page: Page): Promise<void> {
  await page.route(REGISTRY_ROUTE, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/modules/list")) {
      return json(
        route,
        url.searchParams.get("kind") === "Workflow"
          ? {
              modules: [LIVE_MODULE("nf-core/bam_applybqsr", "Workflow")],
              last: true,
            }
          : {
              modules: [
                LIVE_MODULE("nextflow-io/hello", "Process"),
                LIVE_MODULE("nf-core/newtool", "Process"),
                LIVE_MODULE("nf-core/fastqc", "Process", true),
              ],
              last: true,
            },
      );
    }
    if (url.pathname.endsWith("/plugins")) {
      return json(route, { plugins: [{ id: "nf-schema" }], last: true });
    }
    return route.abort();
  });
}

test("F-502 step 1 IO-30 UX-14: with registry.nextflow.io blocked, the palette lists the snapshot's modules and says Snapshot · updated 5 hours ago, with no request to the registry and no console error or CSP violation", async ({
  page,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  const watch = await watchForCspViolations(page);
  const requests = trackRegistryRequests(page);
  await page.route(REGISTRY_ROUTE, (route) => route.abort());
  await page.goto("./");
  await expect(sourceLine(page)).toHaveText("Snapshot · updated 5 hours ago");
  await expect
    .poll(() => moduleNames(page))
    .toEqual(["nf-core/bam_applybqsr", "nf-core/fastqc", "nextflow-io/hello"]);
  await expect(refreshButton(page)).toBeEnabled();
  expect(requests).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-502 step 1 IO-30 ADR-0009: with live forced on and the registry blocked, the palette falls back to the snapshot and says the live registry couldn't be reached", async ({
  page,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  const errors = watchConsole(page);
  await page.route(REGISTRY_ROUTE, (route) => route.abort());
  await page.goto("./");
  await expect(sourceLine(page)).toHaveText("Snapshot · updated 5 hours ago");
  await page.evaluate(() => window.nfBuilderRegistry?.reload({ live: true }));
  await expect(registry(page)).toContainText(
    "The live registry couldn't be reached.",
  );
  await expect(sourceLine(page)).toHaveText("Snapshot · updated 5 hours ago");
  await expect(moduleRows(page)).toHaveCount(3);
  expect(errors.filter((e) => !fromRegistry(e))).toEqual([]);
});

test("F-502 step 2 UX-14: with live forced on and the registry routed with Access-Control-Allow-Origin, the palette says Live, lists a module the snapshot lacks, and drops the revoked one", async ({
  page,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  const watch = await watchForCspViolations(page);
  await routeLiveRegistry(page);
  await page.goto("./");
  await expect(sourceLine(page)).toHaveText("Snapshot · updated 5 hours ago");
  await page.evaluate(() => window.nfBuilderRegistry?.reload({ live: true }));
  await expect(sourceLine(page)).toHaveText("Live · updated just now");
  await expect
    .poll(() => moduleNames(page))
    .toEqual(["nf-core/bam_applybqsr", "nf-core/newtool", "nextflow-io/hello"]);
  await expect(registry(page)).not.toContainText(
    "The live registry couldn't be reached.",
  );
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-502 UX-14: refresh re-reads the snapshot and shows its new age; offline, a refresh keeps the lists and says it couldn't refresh", async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  const errors = watchConsole(page);
  await page.goto("./");
  await expect(sourceLine(page)).toHaveText("Snapshot · updated 5 hours ago");

  await page.route("**/registry/index.json", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, generatedAt: "2026-11-22T04:00:00.000Z" },
    });
  });
  await refreshButton(page).click();
  await expect(sourceLine(page)).toHaveText("Snapshot · updated 1 hour ago");

  await page.unroute("**/registry/index.json");
  await context.setOffline(true);
  await refreshButton(page).click();
  await expect(registry(page)).toContainText(
    "Couldn't refresh the registry data.",
  );
  await expect(moduleRows(page)).toHaveCount(3);
  await expect(sourceLine(page)).toHaveText("Snapshot · updated 1 hour ago");
  expect(
    errors.filter((e) => !e.text.includes("net::ERR_INTERNET_DISCONNECTED")),
  ).toEqual([]);
});

test("F-502 IO-30 ADR-0035: when the site serves no snapshot, the palette says no registry snapshot is available", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.route("**/registry/index.json", (route) =>
    route.fulfill({
      status: 404,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>Not found</title>",
    }),
  );
  await page.goto("./");
  await expect(registry(page)).toContainText(
    "No registry snapshot is available on this site.",
  );
  await expect(refreshButton(page)).toBeEnabled();
  await expect(moduleRows(page)).toHaveCount(0);
  expect(
    errors.filter(
      (e) => !(e.text.includes("404") && e.url.endsWith("index.json")),
    ),
  ).toEqual([]);
});

test("F-502 ADR-0044 QA-30: inside a cross-origin iframe the palette shows the registry snapshot", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await page.setContent(
    `<iframe id="app" src="${PREVIEW_URL}" width="1200" height="800"></iframe>`,
  );
  const frame = page.frameLocator("#app");
  await expect(sourceLine(frame)).toHaveText(/^Snapshot · /);
  await expect(moduleRows(frame)).toHaveCount(3);
  expect(watch.consoleErrors).toEqual([]);
  // The init script also runs in the frame, so its violations are readable there.
  const inner = await (
    await page.locator("#app").elementHandle()
  )?.contentFrame();
  expect(await inner?.evaluate(() => window.__cspViolations ?? [])).toEqual([]);
});
