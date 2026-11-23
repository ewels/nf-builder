import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { WEB_DIST } from "../scripts/check-common.ts";
import { SMOKE_TAG } from "./browsers.ts";
import { canvasReady, openFixture } from "./canvas.ts";
import { lazyJsFiles, MONACO_MARKER, monacoChunks } from "./code-view.ts";
import { watchForCspViolations } from "./csp.ts";

test("F-208 step 3 QA-01 AR-32: Monaco is absent from the initial JavaScript and present in a lazy chunk", () => {
  const { initial } = lazyJsFiles();
  expect(initial.length).toBeGreaterThan(0);
  for (const file of initial)
    expect(readFileSync(join(WEB_DIST, file), "utf8"), file).not.toContain(
      MONACO_MARKER,
    );
  expect(monacoChunks().length).toBeGreaterThan(0);
});

test("F-208 AR-32: no Monaco chunk is requested until the first Split or Code view", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const chunks = monacoChunks().map((f) => `/${f}`);
  const loaded = () =>
    requested.filter((p) => chunks.some((c) => p.endsWith(c)));
  expect(loaded()).toEqual([]);
  await page.getByRole("radio", { name: "Graph" }).click();
  expect(loaded()).toEqual([]);
  await page.keyboard.press("s");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  expect(loaded().length).toBeGreaterThan(0);
});

test("F-208 QA-30 UX-27: Code mode shows Monaco with no CSP violation or console error @smoke", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await page.getByRole("radio", { name: "Code" }).click();
  const editor = page.locator(".monaco-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("nextflow.enable.types");
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});
