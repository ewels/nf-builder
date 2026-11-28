import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import {
  canvasReady,
  clickEmptyCanvas,
  layoutSettled,
  node,
  selectNode,
} from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import { readProject } from "./engine.ts";
import {
  currentFiles,
  historyStatus,
  openStoredFixture,
  storedFiles,
} from "./history.ts";
import { nodePosition, readSidecar } from "./layout.ts";
import {
  addDirective,
  addInput,
  CONFIGURE_START,
  CONFIGURE_TYPED,
  directiveNames,
  GREET_NODE,
  openPopupByDoubleClick,
  popup,
} from "./popup.ts";
import { NARROW, resize } from "./read-only.ts";

const files = (dir: string): Record<string, string> =>
  Object.fromEntries(readProject(dir).map((f) => [f.path, f.text]));
/** The files of `all` that the fixture `dir` also has (a new project holds a template's files besides). */
const ofFixture = (all: Record<string, string>, dir: string) =>
  Object.fromEntries(
    Object.entries(all).filter(([path]) => path in files(dir)),
  );

async function start(page: Page, name: string): Promise<void> {
  await openStoredFixture(page, name, CONFIGURE_START);
  await expect(node(page, GREET_NODE)).toBeVisible();
}

test("F-303 step 1 UX-40: double-clicking a process opens the popup on Configure; Esc closes it and the focus returns to the node", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-open");
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Edit process GREET" }),
  ).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Configure" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByRole("tab", { name: "Code" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(node(page, GREET_NODE)).toBeFocused();
});

test("F-303 UX-40 UX-70 F-206: Enter on the selected node opens the popup; Enter on an unselected node only selects it; the Edit button opens it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-keys");
  await clickEmptyCanvas(page);
  await node(page, GREET_NODE).focus();
  await page.keyboard.press("Enter");
  await expect(node(page, GREET_NODE)).toHaveClass(/selected/);
  await expect(popup(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup(page)).toHaveCount(0);
  await clickEmptyCanvas(page);
  await selectNode(page, GREET_NODE);
  await page
    .getByRole("complementary", { name: "Details" })
    .getByRole("button", { name: "Edit" })
    .click();
  await expect(popup(page)).toBeVisible();
});

test("F-303 step 2 UX-41 UX-44 AR-23: add an input, rename an output, add cpus from the list, Apply: one undo step, code and ports updated", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-edit");
  const startFiles = ofFixture(await storedFiles(page), CONFIGURE_START);
  expect(startFiles).toEqual(files(CONFIGURE_START));
  const before = await historyStatus(page);
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  await addInput(page, { name: "punctuation", type: "String", nullable: true });
  await dialog.locator('[data-field="outputs.0.name"]').fill("message");
  await addDirective(page, "cpus", "cpus");
  await expect(dialog.locator('[data-field="directives.0.args"]')).toHaveValue(
    "1",
  );
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toHaveCount(0);
  await layoutSettled(page);
  const status = await historyStatus(page);
  expect(status.undoCount).toBe(before.undoCount + 1);
  expect(status.undo).toBe("Edit process GREET");
  expect(ofFixture(await storedFiles(page), CONFIGURE_TYPED)).toEqual(
    files(CONFIGURE_TYPED),
  );
  const greet = node(page, GREET_NODE);
  await expect(greet.locator(".canvas-port.is-input")).toHaveText([
    "name",
    "punctuation",
  ]);
  await expect(greet.locator(".canvas-port.is-output:not(:empty)")).toHaveText([
    "message",
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => ofFixture(await currentFiles(page), CONFIGURE_START))
    .toEqual(startFiles);
  expect((await historyStatus(page)).undoCount).toBe(before.undoCount);
});

test("F-303 step 3 UX-41 LA-34: deprecated directives are not offered", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-deprecated");
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  const search = dialog.getByRole("combobox", { name: "Add a directive" });
  await search.fill("storeDir");
  await expect(dialog.getByText("No directives match.")).toBeVisible();
  await search.fill("");
  const catalogue = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "packages/lang-2610/catalogue/script.json"),
      "utf8",
    ),
  ) as { directives: { name: string; deprecated: boolean }[] };
  const expected = catalogue.directives
    .filter((d) => !d.deprecated)
    .map((d) => d.name)
    .sort();
  expect((await directiveNames(page)).sort()).toEqual(expected);
});

test("F-303 step 4 UX-42: there is no control for changing kind", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-kind");
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  await expect(dialog.getByLabel(/kind/i)).toHaveCount(0);
  await expect(
    dialog.locator("select, input[type=radio], [role=radiogroup]"),
  ).toHaveCount(0);
  // the one list box is the directive picker's; the other combos are type and stage fields with suggestions
  await expect(dialog.getByRole("listbox")).toHaveCount(1);
  const others = dialog.locator('[role="combobox"]:not(.directive-picker *)');
  expect(
    await others.evaluateAll((els) =>
      els.every((el) => el.hasAttribute("list")),
    ),
  ).toBe(true);
});

test("F-303 F-207 step 3: renaming a process in the popup keeps its node's position, selection and module", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-rename");
  await expect
    .poll(async () => (await readSidecar(page))?.nodes[GREET_NODE])
    .toBeDefined();
  const stored = (await readSidecar(page))?.nodes[GREET_NODE];
  await selectNode(page, GREET_NODE);
  await openPopupByDoubleClick(page, GREET_NODE);
  await popup(page).locator('[data-field="name"]').fill("SAY");
  await popup(page).getByRole("button", { name: "Apply" }).click();
  await expect(popup(page)).toHaveCount(0);
  await layoutSettled(page);
  await expect(node(page, GREET_NODE).locator(".canvas-node-title")).toHaveText(
    "SAY",
  );
  expect((await readSidecar(page))?.nodes[GREET_NODE]).toEqual(stored);
  expect(await nodePosition(page, GREET_NODE)).toEqual(stored);
  await expect(node(page, GREET_NODE)).toHaveClass(/selected/);
  const all = await storedFiles(page);
  expect(Object.keys(all)).toContain("modules/local/say/main.nf");
  expect(Object.keys(all)).not.toContain("modules/local/greet/main.nf");
  expect((await historyStatus(page)).undo).toBe("Edit process SAY");
});

test("F-303 UX-44: Cancel discards the draft and changes nothing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-cancel");
  const before = await historyStatus(page);
  const startFiles = await storedFiles(page);
  await openPopupByDoubleClick(page, GREET_NODE);
  await popup(page).locator('[data-field="name"]').fill("OTHER");
  await popup(page).getByRole("button", { name: "Cancel" }).click();
  await expect(popup(page)).toHaveCount(0);
  expect(await historyStatus(page)).toEqual(before);
  expect(await currentFiles(page)).toEqual(startFiles);
  // opening it again shows the process as it is
  await openPopupByDoubleClick(page, GREET_NODE);
  await expect(popup(page).locator('[data-field="name"]')).toHaveValue("GREET");
});

test("F-303 UX-44: a refused value keeps the popup open, marks the field and says why", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-refused");
  const before = await historyStatus(page);
  await openPopupByDoubleClick(page, GREET_NODE);
  const dialog = popup(page);
  await dialog.locator('[data-field="outputs.0.value"]').fill("file('a'");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(
    dialog.locator('[data-field="outputs.0.value"]'),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("status").last()).toContainText(
    "Couldn't apply",
  );
  expect(await historyStatus(page)).toEqual(before);
});

test("F-303 F-703 UX-04: in read-only, double-click and Enter don't open the popup, and narrowing closes an open one", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await start(page, "popup-readonly");
  await openPopupByDoubleClick(page, GREET_NODE);
  await expect(popup(page)).toBeVisible();
  await resize(page, NARROW);
  await expect(popup(page)).toHaveCount(0);
  await canvasReady(page);
  await openPopupByDoubleClick(page, GREET_NODE);
  await expect(popup(page)).toHaveCount(0);
  await node(page, GREET_NODE).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(popup(page)).toHaveCount(0);
  await expect(
    page
      .getByRole("complementary", { name: "Details" })
      .getByRole("button", { name: "Edit" }),
  ).toHaveCount(0);
});

test("F-303 QA-30: opening and applying log no CSP violation and no console error", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  const watch = await watchForCspViolations(page);
  await start(page, "popup-csp");
  await openPopupByDoubleClick(page, GREET_NODE);
  await popup(page).locator('[data-field="description"]').fill("Greets.");
  await popup(page).getByRole("button", { name: "Apply" }).click();
  await expect(popup(page)).toHaveCount(0);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});
