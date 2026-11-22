import { expect, test } from "@playwright/test";
import { CONTENT_SECURITY_POLICY } from "../scripts/security-policy.ts";
import { SMOKE_TAG } from "./browsers.ts";
import { watchForCspViolations } from "./csp.ts";
import { DEV_URL, E2E_BASE_PATH } from "./urls.ts";

const DEEP_ROUTE = "projects/example/pipeline";

test("F-002: the app shell shows the header with the app name and three columns, with no CSP violations", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  // ADR 0040: the policy is the first element of <head>, in a <meta http-equiv>, not a response header.
  expect(
    await page.evaluate(() => {
      const first = document.head.firstElementChild;
      return {
        tag: first?.tagName,
        httpEquiv: first?.getAttribute("http-equiv"),
        content: first?.getAttribute("content"),
      };
    }),
  ).toEqual({
    tag: "META",
    httpEquiv: "Content-Security-Policy",
    content: CONTENT_SECURITY_POLICY,
  });
  await expect(
    page
      .getByRole("banner")
      .getByRole("heading", { name: "nf-builder", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Components and files" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main", { name: "Canvas and editor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Details" }),
  ).toBeVisible();
  await page.waitForLoadState("load");
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-002 UX-02: the left column is 256 px and the right 296 px by default; the centre fills the rest", async ({
  page,
}) => {
  await page.goto("./");
  const left = await page
    .getByRole("complementary", { name: "Components and files" })
    .boundingBox();
  const centre = await page
    .getByRole("main", { name: "Canvas and editor" })
    .boundingBox();
  const right = await page
    .getByRole("complementary", { name: "Details" })
    .boundingBox();
  expect(left?.x).toBe(0);
  expect(left?.width).toBe(256);
  expect(centre?.width).toBe(888);
  expect(right?.width).toBe(296);
});

test("F-002 step 1: pnpm dev serves the app and the header shows the app name", async ({
  page,
}) => {
  await page.goto(DEV_URL);
  await expect(
    page.getByRole("banner").getByRole("heading", { name: "nf-builder" }),
  ).toBeVisible();
});

test("F-002 step 2 F-011 step 3 ADR-0040: vite preview serves the build as GitHub Pages does: no security headers, a deep route is 404, and the entry script is under the base", async ({
  request,
}) => {
  const root = await request.get("./");
  const deep = await request.get(DEEP_ROUTE);
  expect(deep.status()).toBe(404);
  const html = await root.text();
  const asset = new RegExp(`src="(${E2E_BASE_PATH}assets/[^"]+\\.js)"`).exec(
    html,
  )?.[1];
  expect(asset).toBeDefined();
  const assetResponse = await request.get(asset ?? "");
  expect(assetResponse.status()).toBe(200);
  for (const response of [root, deep, assetResponse]) {
    const actual = response.headers();
    for (const name of [
      "content-security-policy",
      "referrer-policy",
      "x-frame-options",
      "x-content-type-options",
      "cross-origin-opener-policy",
      "cross-origin-resource-policy",
      "permissions-policy",
    ])
      expect(actual[name], `${response.url()} ${name}`).toBeUndefined();
  }
});

test("F-002 QA-30: the CSP blocks an injected inline script, and the violation is reported", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injectedRan = true";
    document.body.append(script);
  });
  expect(await page.evaluate(() => "__injectedRan" in window)).toBe(false);
  const violations = await watch.violations();
  expect(violations.some((v) => v.startsWith("script-src"))).toBe(true);
});

test("F-002 step 3: the build serves /version.json with the commit and context", async ({
  request,
}) => {
  const response = await request.get("version.json");
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  expect(body).toEqual({
    commit: expect.any(String),
    context: expect.any(String),
  });
});
