import { expect, test } from "@playwright/test";
import {
  CONTENT_SECURITY_POLICY,
  REFERRER_POLICY,
} from "../scripts/security-policy.ts";
import { policyMetaHtml } from "../scripts/security-policy-meta.ts";
import { SMOKE_TAG } from "./browsers.ts";
import { watchForCspViolations } from "./csp.ts";
import { E2E_BASE_PATH, PREVIEW_ORIGIN, PREVIEW_URL } from "./urls.ts";

type HeadMetas = { first: string[]; second: string[] };

/** The first two elements of <head>: tag, then the attributes the policy cares about. */
async function headStart(
  page: import("@playwright/test").Page,
): Promise<HeadMetas> {
  return page.evaluate(() => {
    const summarise = (el: Element | null): string[] => [
      el?.tagName ?? "",
      el?.getAttribute("http-equiv") ?? el?.getAttribute("name") ?? "",
      el?.getAttribute("content") ?? "",
    ];
    const head = document.head.children;
    return {
      first: summarise(head[0] ?? null),
      second: summarise(head[1] ?? null),
    };
  });
}

test("F-011 step 2 QA-30: the app page and the S4 page start <head> with the CSP and referrer meta elements, with no console error", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  expect(policyMetaHtml()).toContain("Content-Security-Policy");
  for (const path of ["./", "spike/s4/"]) {
    const watch = await watchForCspViolations(page);
    await page.goto(path);
    await page.waitForLoadState("load");
    expect(await headStart(page), path).toEqual({
      first: ["META", "Content-Security-Policy", CONTENT_SECURITY_POLICY],
      second: ["META", "referrer", REFERRER_POLICY],
    });
    expect(await watch.violations(), path).toEqual([]);
    expect(watch.consoleErrors, path).toEqual([]);
  }
});

test("F-011 step 3 ADR-0040: the site is served under the base path: /version.json is 404, version.json is 200, and / redirects to the base", async ({
  request,
}) => {
  const root = await request.get(`${PREVIEW_ORIGIN}/version.json`);
  expect(root.status()).toBe(404);
  const version = await request.get("version.json");
  expect(version.status()).toBe(200);
  // Preview-only: `vite preview` redirects / to the base; GitHub Pages does not.
  const redirected = await request.get(`${PREVIEW_ORIGIN}/`, {
    maxRedirects: 0,
  });
  expect([301, 302, 307, 308]).toContain(redirected.status());
  expect(
    new URL(redirected.headers().location ?? "", PREVIEW_ORIGIN).pathname,
  ).toBe(E2E_BASE_PATH);
});

test("F-011 step 4 QA-30: inside a cross-origin iframe the app loads and works", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  // The setContent page is about:blank, so the frame is cross-origin to it.
  await page.setContent(
    `<iframe id="app" src="${PREVIEW_URL}" width="1200" height="800"></iframe>`,
  );
  const frame = page.frameLocator("#app");
  await expect(
    frame.getByRole("banner").getByRole("heading", { name: "nf-builder" }),
  ).toBeVisible();
  await expect(
    frame.getByRole("complementary", { name: "Components and files" }),
  ).toBeVisible();
  await expect(
    frame.getByRole("main", { name: "Canvas and editor" }),
  ).toBeVisible();
  await expect(
    frame.getByRole("complementary", { name: "Details" }),
  ).toBeVisible();
  // The palette is loaded through the engine worker.
  await expect(
    frame
      .getByRole("tabpanel", { name: "Components" })
      .locator(".palette-item-label")
      .first(),
  ).toBeVisible();
  const appFrame = page.frames().find((f) => f.url() === PREVIEW_URL);
  expect(appFrame).toBeDefined();
  expect(await appFrame?.evaluate(() => window.__cspViolations ?? [])).toEqual(
    [],
  );
  expect(watch.consoleErrors).toEqual([]);
});
