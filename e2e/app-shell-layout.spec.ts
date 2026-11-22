import { existsSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { SMOKE_TAG, VISUAL_TAG } from "./browsers.ts";
import { watchForCspViolations } from "./csp.ts";

const BASELINE = "app-shell-default.png";

const left = (page: Page) =>
  page.getByRole("complementary", { name: "Components and files" });
const right = (page: Page) =>
  page.getByRole("complementary", { name: "Details" });
const centre = (page: Page) =>
  page.getByRole("main", { name: "Canvas and editor" });
const leftSep = (page: Page) =>
  page.getByRole("separator", { name: "Resize components and files" });
const rightSep = (page: Page) =>
  page.getByRole("separator", { name: "Resize details" });

async function width(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.width ?? Number.NaN;
}

async function drag(page: Page, sep: Locator, dx: number) {
  const box = await sep.boundingBox();
  if (!box) throw new Error("separator has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
}

test("F-201 step 1 UX-02 QA-30: dragging the separators resizes both side columns within their limits, the widths persist after reload, and no CSP violation occurs", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await drag(page, leftSep(page), 100);
  expect(await width(left(page))).toBe(356);
  await expect(page.locator("html")).not.toHaveClass(/is-resizing/);
  await expect(leftSep(page)).toHaveAttribute("aria-valuenow", "356");
  await drag(page, rightSep(page), -60);
  expect(await width(right(page))).toBe(356);
  expect(await width(centre(page))).toBe(1440 - 356 - 356);
  const max = Number(await leftSep(page).getAttribute("aria-valuemax"));
  await drag(page, leftSep(page), 600);
  expect(await width(left(page))).toBe(max);
  await page.reload();
  expect(await width(left(page))).toBe(max);
  expect(await width(right(page))).toBe(356);
  await page.waitForLoadState("load");
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-201 step 1 UX-02 UX-70: the separators resize with the arrow keys, Home and End, and the widths persist after reload", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  await page.goto("./");
  await leftSep(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(await width(left(page))).toBe(288);
  await page.keyboard.press("Home");
  expect(await width(left(page))).toBe(
    Number(await leftSep(page).getAttribute("aria-valuemin")),
  );
  await page.keyboard.press("End");
  expect(await width(left(page))).toBe(
    Number(await leftSep(page).getAttribute("aria-valuemax")),
  );
  await rightSep(page).focus();
  await page.keyboard.press("ArrowLeft");
  expect(await width(right(page))).toBe(312);
  const leftWidth = await width(left(page));
  await page.reload();
  expect(await width(left(page))).toBe(leftWidth);
  expect(await width(right(page))).toBe(312);
});

test("F-201 step 1 UX-02: both side columns collapse and expand with their buttons, and stay collapsed after reload", async ({
  page,
}) => {
  await page.goto("./");
  const centreBefore = await width(centre(page));
  await page
    .getByRole("button", { name: "Collapse components and files" })
    .click();
  expect(await width(left(page))).toBe(32);
  await expect(
    page.getByRole("button", { name: "Expand components and files" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("separator")).toHaveCount(1);
  expect(await width(centre(page))).toBeGreaterThan(centreBefore);
  await page.getByRole("button", { name: "Collapse details" }).click();
  expect(await width(right(page))).toBe(32);
  await expect(page.getByRole("separator")).toHaveCount(0);
  await page.reload();
  expect(await width(left(page))).toBe(32);
  expect(await width(right(page))).toBe(32);
  await page
    .getByRole("button", { name: "Expand components and files" })
    .click();
  await page.getByRole("button", { name: "Expand details" }).click();
  expect(await width(left(page))).toBe(256);
  expect(await width(right(page))).toBe(296);
});

test("F-201 step 1 UX-02 UX-70: Enter on a separator collapses its column and moves focus to its expand button", async ({
  page,
}) => {
  await page.goto("./");
  await leftSep(page).focus();
  await page.keyboard.press("Enter");
  const expand = page.getByRole("button", {
    name: "Expand components and files",
  });
  await expect(expand).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Collapse components and files" }),
  ).toHaveAttribute("aria-expanded", "true");
});

test("F-201 UX-01: the header shows the project switcher, save state, Templates, Import, Export and a Nextflow version selector listing the installed packs", async ({
  page,
}) => {
  await page.goto("./");
  const header = page.getByRole("banner");
  for (const name of ["No project", "Templates", "Import", "Export"])
    await expect(header.getByRole("button", { name })).toBeDisabled();
  await expect(header.getByText("Nothing to save")).toBeVisible();
  const select = header.getByRole("combobox", { name: "Nextflow version" });
  const values = await select
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) expect(v).toMatch(/^\d+\.\d+$/);
});

test("F-201 UX-03: the status bar shows problems and suggestions counts, node and channel counts, and the selected language version", async ({
  page,
}) => {
  await page.goto("./");
  const version = await page
    .getByRole("combobox", { name: "Nextflow version" })
    .inputValue();
  const bar = page.getByRole("contentinfo");
  for (const text of [
    "No problems",
    "No suggestions",
    "0 nodes",
    "0 channels",
    `Nextflow ${version}`,
  ])
    await expect(bar).toContainText(text);
});

test("F-201 UX-02: the centre column shows a tab strip above the canvas area", async ({
  page,
}) => {
  await page.goto("./");
  const strip = centre(page).locator(".tab-strip");
  await expect(strip).toBeVisible();
  const s = await strip.boundingBox();
  const c = await centre(page).locator(".canvas-area").boundingBox();
  expect((s?.y ?? 0) + (s?.height ?? 0)).toBeLessThanOrEqual((c?.y ?? 0) + 0.5);
});

test(
  "F-201 step 2 UX-01 UX-02 UX-03: the default app shell matches the approved baseline",
  {
    tag: VISUAL_TAG,
  },
  async ({ page }, testInfo) => {
    await page.goto("./");
    await page.getByRole("contentinfo").waitFor();
    await page
      .getByRole("button", { name: "Processes", exact: true })
      .waitFor();
    const guidance =
      "No approved baseline, or the shell changed: download the playwright-chromium artifact, view the -actual.png and commit it as the baseline (ADR 0021)";
    // With updateSnapshots "none" Playwright writes no -actual.png for a missing baseline, so write it here.
    if (!existsSync(testInfo.snapshotPath(BASELINE))) {
      const actual = testInfo.outputPath("app-shell-default-actual.png");
      await page.screenshot({
        path: actual,
        animations: "disabled",
        caret: "hide",
      });
      await testInfo.attach("app-shell-default-actual.png", {
        path: actual,
        contentType: "image/png",
      });
      throw new Error(
        `${guidance}. Expected at ${testInfo.snapshotPath(BASELINE)}`,
      );
    }
    await expect(page, guidance).toHaveScreenshot(BASELINE);
  },
);
