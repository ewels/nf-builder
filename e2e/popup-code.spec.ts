import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { canvasReady, layoutSettled, node, selectNode } from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import { readProject } from "./engine.ts";
import {
  currentFiles,
  historyStatus,
  openStoredFixture,
  storedFiles,
} from "./history.ts";
import {
  CODE_EDITED,
  CONFIGURE_START,
  COUNTED_NODE,
  codeText,
  declarationOf,
  FORMAT_START,
  formattedSlice,
  GREET_NODE,
  openCodeTab,
  openPopupByDoubleClick,
  popup,
  typeInPopupEditor,
} from "./popup.ts";
import { NARROW, resize } from "./read-only.ts";

const MODULE = "modules/local/greet/main.nf";
const files = (dir: string): Record<string, string> =>
  Object.fromEntries(readProject(dir).map((f) => [f.path, f.text]));
const ofFixture = (all: Record<string, string>, dir: string) =>
  Object.fromEntries(
    Object.entries(all).filter(([path]) => path in files(dir)),
  );
const readModule = (dir: string): string =>
  readFileSync(join(dir, MODULE), "utf8");

async function start(page: Page, name: string): Promise<void> {
  await openStoredFixture(page, name, CONFIGURE_START);
  await expect(node(page, GREET_NODE)).toBeVisible();
}

test("F-304 step 1 UX-44 UX-43: edit in Code, switch to Configure and the form reflects it; Apply is one undo step", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-code-edit");
  const startFiles = ofFixture(await storedFiles(page), CONFIGURE_START);
  const before = await historyStatus(page);
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  await openCodeTab(page);
  await expect(dialog.locator(".code-editor-host")).toHaveAttribute(
    "data-language",
    "nextflow",
  );
  expect(await codeText(page)).toBe(declarationOf(readModule(CONFIGURE_START)));
  await typeInPopupEditor(page, declarationOf(readModule(CODE_EDITED)));
  await dialog.getByRole("tab", { name: "Configure" }).click();
  await expect(dialog.locator('[data-field="description"]')).toHaveValue(
    "Writes a friendly greeting.",
  );
  await expect(dialog.locator('[data-field="directives.0.args"]')).toHaveValue(
    "2",
  );
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toHaveCount(0);
  await layoutSettled(page);
  const status = await historyStatus(page);
  expect(status.undoCount).toBe(before.undoCount + 1);
  expect(status.undo).toBe("Edit process GREET");
  expect(ofFixture(await storedFiles(page), CODE_EDITED)).toEqual(
    files(CODE_EDITED),
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => ofFixture(await currentFiles(page), CONFIGURE_START))
    .toEqual(startFiles);
});

test("F-304 step 2 UX-44: a syntax error disables Apply and Configure and shows inline; fixing it enables both", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-code-error");
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  await openCodeTab(page);
  const history = await historyStatus(page);
  await dialog.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Backspace");
  const apply = dialog.getByRole("button", { name: "Apply" });
  await expect(apply).toBeDisabled();
  await expect(
    dialog.locator(".monaco-editor .squiggly-error").first(),
  ).toBeVisible();
  await expect(dialog.locator(".code-tab-problem")).not.toBeEmpty();
  await expect(dialog.getByRole("tab", { name: "Configure" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  // the editor keeps its own undo; the project's history doesn't move
  await page.keyboard.press("ControlOrMeta+z");
  await expect(apply).toBeEnabled();
  await expect(
    dialog.getByRole("tab", { name: "Configure" }),
  ).not.toHaveAttribute("aria-disabled", "true");
  expect(await historyStatus(page)).toEqual(history);
});

test("F-304 step 3 UX-43: Format gives the oracle formatter's text for the declaration", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "popup-code-format", FORMAT_START);
  await openPopupByDoubleClick(page, COUNTED_NODE);
  const dialog = popup(page);
  await openCodeTab(page);
  expect(await codeText(page)).not.toBe(formattedSlice());
  await dialog.getByRole("button", { name: "Format", exact: true }).click();
  await expect.poll(() => codeText(page)).toBe(formattedSlice());
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeEnabled();
});

test("F-304 UX-43: Show whole file shows the other declarations read-only with this one selected, and back", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-code-whole");
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  await openCodeTab(page);
  const toggle = dialog.getByRole("button", { name: "Show whole file" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".code-editor-host")).toHaveAttribute(
    "data-whole-file",
    "true",
  );
  await expect
    .poll(() => codeText(page))
    .toContain("nextflow.enable.types = true");
  await expect(
    dialog.locator(".popup-declaration-lines").first(),
  ).toBeVisible();
  await dialog.locator(".monaco-editor .view-lines").click();
  const whole = await codeText(page);
  await page.keyboard.insertText("zzz");
  expect(await codeText(page)).toBe(whole);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await codeText(page)).toBe(declarationOf(readModule(CONFIGURE_START)));
});

test("F-304 UX-43: the find widget and the context menu work inside the modal; Esc closes the widget first, then the popup", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-code-widgets");
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  await openCodeTab(page);
  await dialog.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+f");
  const find = dialog.locator(".monaco-editor .find-widget");
  await expect(find).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.insertText("greeting");
  await expect(find.locator(".matchesCount")).toContainText(/of \d+/);
  await page.keyboard.press("Escape");
  await expect(find).toHaveAttribute("aria-hidden", "true");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await dialog.locator(".monaco-editor .view-lines").click({ button: "right" });
  // the menu is drawn inside the dialog, so the modal's top layer doesn't hide it, and its items take clicks
  const menu = dialog.locator(".context-view");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Copy/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  // the first Escape collapses the selection Monaco still holds, the second closes the unedited popup
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("F-304 UX-44 ADR 0066: Esc with an edited code draft asks before discarding; Keep editing keeps it, Discard changes nothing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-code-esc");
  const startFiles = ofFixture(await storedFiles(page), CONFIGURE_START);
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  await openCodeTab(page);
  await typeInPopupEditor(page, declarationOf(readModule(CODE_EDITED)));
  await page.keyboard.press("Escape");
  const ask = dialog.getByRole("alert");
  await expect(ask).toContainText("Discard your changes to the code?");
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(ask).toHaveCount(0);
  // the editor has scrolled to the end of the pasted text, so only its last lines are drawn
  expect(await codeText(page)).toContain("// keep the greeting short");
  await page.keyboard.press("Escape");
  await ask.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toHaveCount(0);
  expect(ofFixture(await currentFiles(page), CONFIGURE_START)).toEqual(
    startFiles,
  );
});

test("F-304 UX-32 F-206: the details Code button opens the popup on the Code tab", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-code-details");
  await selectNode(page, GREET_NODE);
  await page
    .getByRole("complementary", { name: "Details" })
    .getByRole("button", { name: "Code" })
    .click();
  const dialog = popup(page);
  await expect(dialog.getByRole("tab", { name: "Code" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
});

test("F-304 F-703 UX-04: in read-only the details Code button is gone and the popup doesn't open", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-code-readonly");
  await resize(page, NARROW);
  await canvasReady(page);
  await selectNode(page, GREET_NODE);
  await expect(
    page
      .getByRole("complementary", { name: "Details" })
      .getByRole("button", { name: "Code" }),
  ).toHaveCount(0);
  await openPopupByDoubleClick(page, GREET_NODE);
  await expect(popup(page)).toHaveCount(0);
});

test("F-304 QA-30: the Code tab logs no CSP violation and no console error", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  const watch = await watchForCspViolations(page);
  await start(page, "popup-code-csp");
  await openPopupByDoubleClick(page, GREET_NODE);
  await openCodeTab(page);
  await typeInPopupEditor(page, declarationOf(readModule(CODE_EDITED)));
  await popup(page).getByRole("button", { name: "Apply" }).click();
  await expect(popup(page)).toHaveCount(0);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});
