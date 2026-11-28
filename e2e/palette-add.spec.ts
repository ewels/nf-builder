import { expect, type Page, test } from "@playwright/test";
import { canvasReady, layoutSettled, node } from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import { expandPath, showFiles, treeRow } from "./files.ts";
import { historyStatus } from "./history.ts";
import { readSidecar } from "./layout.ts";
import {
  addStatus,
  caseFiles,
  dragToCanvas,
  expectBoxContains,
  nodeBox,
  paletteItem,
  paneCentre,
  projectFiles,
  viewportTransform,
} from "./palette-add.ts";
import { createProjectInUi, readFile, switcher } from "./projects.ts";

const PROCESS = "main.nf#/NEW_PROCESS@1";
const WORKFLOW = "main.nf#/NEW_WORKFLOW@1";

/** A new stored project from the blank template, its canvas drawn and settled. */
async function blank(page: Page, name: string): Promise<void> {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, name);
  await canvasReady(page);
  await layoutSettled(page);
}

/** Focuses a palette item and presses Enter. */
async function addByKeyboard(page: Page, label: string): Promise<void> {
  await paletteItem(page, label).focus();
  await page.keyboard.press("Enter");
}

test("F-301 step 1 UX-15 LA-12: dragging Process onto the canvas adds a node at the drop point; Files shows modules/local/new_process/main.nf; main.nf has the include and the call", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blank(page, "palette-drag");
  const dropped = await dragToCanvas(page, "Process", { x: 500, y: 300 });
  await expect(node(page, PROCESS)).toBeVisible();
  await layoutSettled(page);
  expectBoxContains(await nodeBox(page, PROCESS), dropped);
  const sidecar = async () => (await readSidecar(page))?.nodes[PROCESS];
  await expect.poll(sidecar).toBeDefined();
  await showFiles(page);
  await expandPath(page, "modules/local/new_process/main.nf");
  await expect(
    treeRow(page, "modules/local/new_process/main.nf"),
  ).toBeVisible();
  const main = (await readFile(page, "main.nf")) ?? "";
  expect(main).toContain(
    "include { NEW_PROCESS } from './modules/local/new_process/main.nf'",
  );
  expect(main).toContain("NEW_PROCESS()");
});

test("F-301 step 2 UX-15 UX-70 QA-11: focusing Workflow and pressing Enter adds a node at the viewport centre", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blank(page, "palette-keys");
  const item = paletteItem(page, "Workflow");
  await item.focus();
  await expect(item).toBeFocused();
  const summary = await item.locator("xpath=..").getAttribute("title");
  expect(summary).toBeTruthy();
  await expect(item).toHaveAccessibleDescription(summary ?? "");
  const before = await viewportTransform(page);
  await page.keyboard.press("Enter");
  await expect(node(page, WORKFLOW)).toBeVisible();
  await layoutSettled(page);
  expectBoxContains(await nodeBox(page, WORKFLOW), await paneCentre(page));
  expect(await viewportTransform(page)).toBe(before);
  await expect(addStatus(page)).toHaveText(
    "Added workflow NEW_WORKFLOW to the entry workflow.",
  );
  await expect(item).toBeFocused();
  const box = await nodeBox(page, WORKFLOW);
  await expect
    .poll(async () => {
      const stored = (await readSidecar(page))?.nodes[WORKFLOW];
      const flow = await node(page, WORKFLOW).evaluate((el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return { x: m.m41, y: m.m42 };
      });
      return JSON.stringify(stored) === JSON.stringify(flow);
    })
    .toBe(true);
  expect(box.width).toBeGreaterThan(0);
  await expect(page.getByText("Laying out nodes…")).toHaveCount(0);
});

test("F-301 step 3 LA-12: after both adds the project's files equal oracle case f301-palette-adds", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blank(page, "palette-oracle");
  await addByKeyboard(page, "Process");
  await expect(node(page, PROCESS)).toBeVisible();
  await addByKeyboard(page, "Workflow");
  await expect(node(page, WORKFLOW)).toBeVisible();
  expect(await projectFiles(page)).toEqual(caseFiles());
});

test("F-301 AR-23: one undo removes the process, its module file and the include; redo restores them", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blank(page, "palette-undo");
  const start = await projectFiles(page);
  await addByKeyboard(page, "Process");
  await expect(node(page, PROCESS)).toBeVisible();
  const added = await projectFiles(page);
  expect(Object.keys(added)).toContain("modules/local/new_process/main.nf");
  expect((await historyStatus(page)).undoCount).toBe(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(node(page, PROCESS)).toHaveCount(0);
  expect(await projectFiles(page)).toEqual(start);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(node(page, PROCESS)).toBeVisible();
  expect(await projectFiles(page)).toEqual(added);
});

test("F-301 UX-15: an item with no action says so and changes nothing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blank(page, "palette-none");
  const before = await historyStatus(page);
  const main = await readFile(page, "main.nf");
  const item = paletteItem(page, "map");
  await item.focus();
  await expect(item).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(addStatus(page)).toHaveText(
    "map can't be added from the palette yet.",
  );
  expect(await historyStatus(page)).toEqual(before);
  expect(await readFile(page, "main.nf")).toBe(main);
});

test("F-301 F-210: the canvas accepts a palette drag and not a text drag, and the Files drop guard still refuses a Files drag over it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blank(page, "palette-guard");
  // a synthetic event keeps dropEffect "none" in Chromium, so only whether the drag is accepted can be read; the guard
  // refuses a Files drag by cancelling it, the canvas accepts a palette drag by cancelling it
  const accepted = (kind: "palette" | "text" | "files") =>
    page.locator(".react-flow__pane").evaluate((pane, kind) => {
      const dt = new DataTransfer();
      if (kind === "palette")
        dt.setData("application/x-nf-builder-palette", "x");
      else if (kind === "text") dt.setData("text/plain", "x");
      else dt.items.add(new File(["x"], "a.txt", { type: "text/plain" }));
      const event = new DragEvent("dragover", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      });
      pane.dispatchEvent(event);
      return { types: [...dt.types], prevented: event.defaultPrevented };
    }, kind);
  expect(await accepted("palette")).toEqual({
    types: ["application/x-nf-builder-palette"],
    prevented: true,
  });
  expect(await accepted("text")).toEqual({
    types: ["text/plain"],
    prevented: false,
  });
  const files = await accepted("files");
  expect(files.types).toContain("Files");
  expect(files.prevented).toBe(true);
});

test("F-301 QA-30: adding logs no CSP violation and no console error", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  const watch = await watchForCspViolations(page);
  await blank(page, "palette-csp");
  await dragToCanvas(page, "Process", { x: 400, y: 250 });
  await expect(node(page, PROCESS)).toBeVisible();
  await addByKeyboard(page, "Workflow");
  await expect(node(page, WORKFLOW)).toBeVisible();
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-301 UX-15: on a canvas that has nodes, adding by Enter and by drop keeps a panned viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blank(page, "palette-viewport");
  await addByKeyboard(page, "Workflow");
  await expect(node(page, WORKFLOW)).toBeVisible();
  await layoutSettled(page);
  const centre = await paneCentre(page);
  await page.mouse.move(centre.x + 200, centre.y + 150);
  await page.mouse.down();
  await page.mouse.move(centre.x + 50, centre.y + 50, { steps: 10 });
  await page.mouse.up();
  const panned = await viewportTransform(page);
  await addByKeyboard(page, "Process");
  await expect(node(page, PROCESS)).toBeVisible();
  await layoutSettled(page);
  await page.waitForTimeout(500);
  expect(await viewportTransform(page)).toBe(panned);
  expectBoxContains(await nodeBox(page, PROCESS), await paneCentre(page));
  const dropped = await dragToCanvas(page, "Process", { x: 150, y: 120 });
  await expect(node(page, "main.nf#/NEW_PROCESS_2@1")).toBeVisible();
  await layoutSettled(page);
  await page.waitForTimeout(500);
  expect(await viewportTransform(page)).toBe(panned);
  expectBoxContains(await nodeBox(page, "main.nf#/NEW_PROCESS_2@1"), dropped);
});
