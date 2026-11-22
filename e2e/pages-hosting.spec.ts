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
  const redirected = await request.get(`${PREVIEW_ORIGIN}/`, {
    maxRedirects: 0,
  });
  expect([301, 302, 307, 308]).toContain(redirected.status());
  expect(
    new URL(redirected.headers().location ?? "", PREVIEW_ORIGIN).pathname,
  ).toBe(E2E_BASE_PATH);
});

test('F-011 step 4 QA-30: inside a cross-origin frame the app does not mount and offers "Open in a new tab"', async ({
  page,
}) => {
  // about:blank to a different origin: the outer page is not localhost:4173, so the frame is cross-origin.
  await page.setContent(
    `<iframe id="app" src="${PREVIEW_URL}" width="900" height="600"></iframe>`,
  );
  const frame = page.frameLocator("#app");
  await expect(
    frame.getByText("nf-builder can't run inside another page."),
  ).toBeVisible();
  const link = frame.getByRole("link", { name: "Open in a new tab" });
  await expect(link).toHaveAttribute("href", PREVIEW_URL);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(frame.getByRole("banner")).toHaveCount(0);
});
