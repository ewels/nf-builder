import { expect, test } from "@playwright/test";
import { SMOKE_TAG } from "./browsers.ts";
import { NODE, selectNode } from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import { switcher } from "./projects.ts";
import {
  horizontalOverflow,
  NARROW,
  NOTE_TEXT,
  openStoredCanvas,
  PHONE,
  readOnlyNote,
  resize,
  WIDE,
} from "./read-only.ts";

const palette = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary", { name: "Components and files" });
const details = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary", { name: "Details" });

test("F-703 UX-04: at 390 px the app starts read-only with the note and without the palette or project actions", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  const watch = await watchForCspViolations(page);
  await page.setViewportSize(PHONE);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator('[role="separator"]')).toHaveCount(0);
  await expect(page.getByLabel("Nextflow version")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Templates" })).toHaveCount(0);
  await expect(details(page)).toBeVisible();
  await switcher(page).click();
  await expect(page.getByText("No projects in this browser.")).toBeVisible();
  await expect(page.getByRole("button", { name: /New project/ })).toHaveCount(
    0,
  );
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-703 UX-04: the switch is at 1024 px, and canvas and details stack below 640 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await expect(readOnlyNote(page)).toHaveCount(0);
  await expect(palette(page)).toBeVisible();

  await resize(page, { width: 1023, height: 768 });
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  await expect(palette(page)).toHaveCount(0);
  const main = page.getByRole("main", { name: "Canvas and editor" });
  const sideBySide = async () => {
    const a = await main.boundingBox();
    const b = await details(page).boundingBox();
    if (a === null || b === null) throw new Error("no boxes");
    return { a, b };
  };
  let { a, b } = await sideBySide();
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);
  expect(Math.abs(b.y - a.y)).toBeLessThan(2);

  await resize(page, { width: 640, height: 768 });
  ({ a, b } = await sideBySide());
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);

  await resize(page, { width: 639, height: 768 });
  ({ a, b } = await sideBySide());
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  expect(Math.abs(b.x - a.x)).toBeLessThan(2);
  expect(await horizontalOverflow(page)).toBe(0);

  await resize(page, { width: 1024, height: 768 });
  await expect(readOnlyNote(page)).toHaveCount(0);
  await expect(palette(page)).toBeVisible();
});

test("F-703 UX-04 QA-10: a crossing moves lost focus to the note, and nothing scrolls sideways at 320 px", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // the browser refuses persistent storage, so the header shows its note
    Object.defineProperty(navigator.storage, "persisted", {
      value: async () => false,
      configurable: true,
    });
    Object.defineProperty(navigator.storage, "persist", {
      value: async () => false,
      configurable: true,
    });
  });
  await openStoredCanvas(
    page,
    "A project with a rather long name of 40 characters",
  );
  await expect(page.locator(".storage-note")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search components" }).focus();
  await resize(page, PHONE);
  await expect(readOnlyNote(page)).toBeFocused();

  for (const width of [320, 390, 639]) {
    await resize(page, { width, height: 640 });
    expect(await horizontalOverflow(page), `${width} px`).toBe(0);
  }
  await resize(page, WIDE);
  await expect(readOnlyNote(page)).toHaveCount(0);
});

test("F-703 UX-04: narrow windows keep the side-by-side layout at 1000 px", async ({
  page,
}) => {
  await page.setViewportSize(NARROW);
  await page.goto("./");
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  expect(await horizontalOverflow(page)).toBe(0);
});

test("F-703 UX-04: entering read-only closes an open dialog and leaves only the project list in the switcher", async ({
  page,
}) => {
  await openStoredCanvas(page, "Dialog project");
  await page.getByRole("button", { name: "Templates" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog).toBeVisible();
  await resize(page, PHONE);
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await switcher(page).click();
  await expect(
    page.locator(".project-panel").getByRole("button", {
      name: "Dialog project",
    }),
  ).toBeVisible();
  for (const gone of ["New project", "Rename project", "Delete project"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  // the details header has no Edit or Code buttons even with a node selected
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Fit view" }).click();
  await selectNode(page, NODE.greeted);
  await expect(
    details(page).getByRole("button", { name: /^(Edit|Code)$/ }),
  ).toHaveCount(0);
});
