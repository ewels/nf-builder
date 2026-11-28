import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { canvasReady, layoutSettled } from "./canvas.ts";
import { configCard, configReady } from "./config.ts";
import { watchForCspViolations } from "./csp.ts";
import { readProject } from "./engine.ts";
import { historyStatus } from "./history.ts";
import { addStatus } from "./palette-add.ts";
import { engineDiagnostics } from "./problems.ts";
import { createProjectInUi, readFile, switcher } from "./projects.ts";
import { chooseZip, writeZip } from "./zips.ts";

/** The oracle case the blank template plus the nf-schema plugin must equal (CI lints it). */
const CASE = join(REPO_ROOT, "tools/oracle/cases/f505-plugin");
const caseConfig = (): string =>
  readProject(CASE).find((f) => f.path === "nextflow.config")?.text ?? "";

const panel = (page: Page): Locator =>
  page.getByRole("tabpanel", { name: "Components" });
const search = (page: Page): Locator =>
  panel(page).getByRole("searchbox", { name: "Search components" });
/** The nf-schema row's button in the registry Plugins list (listed while searching). */
const pluginButton = (page: Page): Locator =>
  panel(page).locator('.registry-item[data-name="nf-schema"] button');

/** A new stored project from the blank template, its canvas drawn, with nf-schema found in the palette. */
async function blankWithSearch(page: Page, name: string): Promise<void> {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, name);
  await canvasReady(page);
  await layoutSettled(page);
  await search(page).fill("nf-schema");
  await expect(pluginButton(page)).toBeVisible();
}

const undoCount = async (page: Page): Promise<number> =>
  (await historyStatus(page)).undoCount;

test("F-505 step 1 IO-33 UX-15: search nf-schema, focus its row and press Enter: nextflow.config gains id 'nf-schema@3.1.0' and the palette lists its functions", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blankWithSearch(page, "plugin-keys");
  const row = pluginButton(page);
  await row.focus();
  await expect(row).toBeFocused();
  const summary = await row.locator("xpath=..").getAttribute("title");
  expect(summary).toBeTruthy();
  await expect(row).toHaveAccessibleDescription(summary ?? "");
  await page.keyboard.press("Enter");
  await expect(addStatus(page)).toHaveText(
    "Added plugin nf-schema@3.1.0 to nextflow.config.",
  );
  expect(await readFile(page, "nextflow.config")).toBe(caseConfig());
  await expect(row).toBeFocused();
  await expect(row).toContainText("added");
  const group = panel(page).locator(".plugin-groups");
  await expect(
    group.getByRole("heading", { name: "From plugins" }),
  ).toBeVisible();
  await expect(
    group.getByRole("button", { name: /^nf-schema 3\.1\.0/ }),
  ).toBeVisible();
  await expect(
    group.getByRole("button", { name: "samplesheetToList" }),
  ).toBeVisible();
  const call = group.getByRole("button", { name: "validateParameters" });
  await expect(call).toHaveAttribute("aria-disabled", "true");
  await call.focus();
  await page.keyboard.press("Enter");
  await expect(addStatus(page)).toHaveText(
    "validateParameters can't be added from the palette yet.",
  );
  expect(await readFile(page, "nextflow.config")).toBe(caseConfig());
});

test("F-505 step 1 UX-15: dragging the nf-schema row onto the canvas adds the same line", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blankWithSearch(page, "plugin-drag");
  await pluginButton(page).dragTo(page.locator(".workflow-canvas"), {
    targetPosition: { x: 300, y: 200 },
  });
  await expect(addStatus(page)).toHaveText(
    "Added plugin nf-schema@3.1.0 to nextflow.config.",
  );
  expect(await readFile(page, "nextflow.config")).toBe(caseConfig());
});

test("F-505 AR-23: one undo removes the line and the functions leave the palette", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blankWithSearch(page, "plugin-undo");
  const before = await readFile(page, "nextflow.config");
  const start = await undoCount(page);
  await pluginButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).locator(".plugin-groups")).toBeVisible();
  expect(await undoCount(page)).toBe(start + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => readFile(page, "nextflow.config")).toBe(before);
  await expect(panel(page).locator(".plugin-groups")).toHaveCount(0);
  await expect(pluginButton(page)).not.toContainText("added");
  expect(await undoCount(page)).toBe(start);
});

test("F-505 IO-33 AR-23: a project with no nextflow.config gets one with the plugins block, and one undo removes both", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  const zip = testInfo.outputPath("no-config.zip");
  const main = readProject(CASE).find((f) => f.path === "main.nf")?.text ?? "";
  writeZip({ "main.nf": main }, zip);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const dialog = await chooseZip(page, zip);
  await dialog.getByLabel("Name").fill("plugin-no-config");
  await dialog.getByRole("button", { name: "Create" }).click();
  await dialog.waitFor({ state: "hidden" });
  await canvasReady(page);
  await layoutSettled(page);
  expect(await readFile(page, "nextflow.config")).toBeNull();
  await search(page).fill("nf-schema");
  await expect(pluginButton(page)).toBeVisible();
  const start = await undoCount(page);
  await pluginButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(addStatus(page)).toHaveText(
    "Added plugin nf-schema@3.1.0 to nextflow.config.",
  );
  expect(await readFile(page, "nextflow.config")).toBe(
    "plugins {\n    id 'nf-schema@3.1.0'\n}\n",
  );
  expect(await undoCount(page)).toBe(start + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => readFile(page, "nextflow.config")).toBeNull();
  await expect(pluginButton(page)).not.toContainText("added");
  expect(await undoCount(page)).toBe(start);
});

test("F-505 FI-01: in the nextflow.config form, Add scope lists validation and setting validation.monochromeLogs raises no unknown-option warning", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blankWithSearch(page, "plugin-config");
  await pluginButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).locator(".plugin-groups")).toBeVisible();
  await page.getByRole("button", { name: "Open nextflow.config" }).click();
  await configReady(page);
  await page.getByRole("button", { name: "Add scope…" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add scope" });
  await dialog.getByRole("button", { name: /^validation\b/ }).click();
  await dialog.waitFor({ state: "hidden" });
  const card = configCard(page, "validation");
  await card.getByRole("button", { name: "Add option…" }).first().click();
  const options = page.getByRole("dialog", {
    name: "Add option to validation",
  });
  await options.getByRole("button", { name: /^monochromeLogs\b/ }).click();
  await options.waitFor({ state: "hidden" });
  const field = card.locator(
    '[data-option="monochromeLogs"] :is(input, select)',
  );
  await field.first().focus();
  await expect(page.locator(".config-details")).toContainText("monochromeLogs");
  await field.first().selectOption("true");
  await expect
    .poll(() => readFile(page, "nextflow.config"))
    .toContain("monochromeLogs = true");
  expect(
    (await engineDiagnostics(page)).filter(
      (d) => d.path === "nextflow.config" && d.code === "config-unknown-option",
    ),
  ).toEqual([]);
  await expect(
    card.locator('[data-option="monochromeLogs"]'),
  ).not.toContainText("Unknown option");
});

test("F-505 IO-33: adding nf-schema again says it is already there and changes nothing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blankWithSearch(page, "plugin-twice");
  await pluginButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(pluginButton(page)).toContainText("added");
  const text = await readFile(page, "nextflow.config");
  const count = await undoCount(page);
  await page.keyboard.press("Enter");
  await expect(addStatus(page)).toHaveText(
    "nf-schema is already in nextflow.config.",
  );
  expect(await readFile(page, "nextflow.config")).toBe(text);
  expect(await undoCount(page)).toBe(count);
});

test("F-505 QA-30: no CSP violations or console errors", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  const watch = await watchForCspViolations(page);
  await blankWithSearch(page, "plugin-csp");
  await pluginButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).locator(".plugin-groups")).toBeVisible();
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});
