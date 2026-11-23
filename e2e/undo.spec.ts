import { expect, type Page, test } from "@playwright/test";
import { canvasReady } from "./canvas.ts";
import { canvasIds, editor } from "./code-view.ts";
import { readProject } from "./engine.ts";
import {
  applyThroughStore,
  currentFiles,
  HISTORY_FIXTURE,
  historyStatus,
  openStoredFixture,
  portRef,
  pressRedo,
  pressUndo,
  storedFiles,
  typeComment,
} from "./history.ts";
import { readFile } from "./projects.ts";

const entry = { path: "main.nf", workflow: null };
const radio = (page: Page, name: string) =>
  page.getByRole("radiogroup", { name: "View mode" }).getByRole("radio", {
    name,
  });
const button = (page: Page, name: "Undo" | "Redo") =>
  page.getByRole("button", { name, exact: true });
const syncStatus = (page: Page) => page.locator(".code-pane-status");

/** Waits for the undo count to reach `n`. */
const undoCountIs = (page: Page, n: number) =>
  expect.poll(async () => (await historyStatus(page)).undoCount).toBe(n);
const redoCountIs = (page: Page, n: number) =>
  expect.poll(async () => (await historyStatus(page)).redoCount).toBe(n);

async function openSplit(page: Page, name: string): Promise<void> {
  await openStoredFixture(page, name);
  await radio(page, "Split").click();
  await expect(editor(page)).toBeVisible();
}

test("F-209 step 1 step 2 AR-23 IO-01: five different edits each add one step; five keyboard undos leave every stored and engine file byte-identical to the start; five keyboard redos give the edited state byte for byte", async ({
  page,
}) => {
  await openSplit(page, "Five edits");
  const startStored = await storedFiles(page);
  const startFiles = await currentFiles(page);
  expect(startFiles).toEqual(startStored);
  const startIds = await canvasIds(page);
  await undoCountIs(page, 0);

  await applyThroughStore(page, {
    kind: "addCall",
    target: entry,
    callee: "ALIGN",
  });
  await undoCountIs(page, 1);
  await applyThroughStore(page, {
    kind: "connect",
    target: entry,
    from: await portRef(page, "reads", "out"),
    to: await portRef(page, "ALIGN@1", "sample"),
  });
  await undoCountIs(page, 2);
  await expect(editor(page)).toContainText("ALIGN(reads)");
  // a code edit typed in Split mode (a comment line, which the parser keeps)
  await typeComment(page, "// typed in split mode");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  await undoCountIs(page, 3);
  await applyThroughStore(page, {
    kind: "createProcess",
    name: "REPORT",
    caller: "main.nf",
  });
  await undoCountIs(page, 4);
  await applyThroughStore(page, {
    kind: "renameDeclaration",
    path: "modules/local/count/main.nf",
    name: "COUNT",
    newName: "COUNT_LINES",
  });
  await undoCountIs(page, 5);
  await expect(editor(page)).toContainText("COUNT_LINES");

  const editedStored = await storedFiles(page);
  const editedIds = await canvasIds(page);
  expect(editedStored).not.toEqual(startStored);
  expect(Object.keys(editedStored)).toContain("modules/local/report/main.nf");

  for (let left = 4; left >= 0; left--) {
    await pressUndo(page);
    await undoCountIs(page, left);
  }
  await expect(page.locator(".react-flow__node")).toHaveCount(startIds.length);
  expect(await storedFiles(page)).toEqual(startStored);
  expect(await currentFiles(page)).toEqual(startFiles);
  expect(await canvasIds(page)).toEqual(startIds);
  await expect(editor(page)).not.toContainText("typed in split mode");
  await expect(editor(page)).not.toContainText("COUNT_LINES");
  expect((await historyStatus(page)).redoCount).toBe(5);

  for (let done = 1; done <= 5; done++) {
    await pressRedo(page);
    await redoCountIs(page, 5 - done);
  }
  await expect(page.locator(".react-flow__node")).toHaveCount(editedIds.length);
  expect(await storedFiles(page)).toEqual(editedStored);
  expect(await canvasIds(page)).toEqual(editedIds);
  await expect(editor(page)).toContainText("typed in split mode");
});

test("F-209 AR-23 UX-26: disconnect, delete node and connect are undone and redone with the buttons, whose titles name each step", async ({
  page,
}) => {
  await openStoredFixture(page, "Buttons");
  const startStored = await storedFiles(page);
  await expect(button(page, "Undo")).toBeDisabled();
  await expect(button(page, "Redo")).toBeDisabled();
  await applyThroughStore(page, {
    kind: "addCall",
    target: entry,
    callee: "ALIGN",
  });
  await applyThroughStore(page, {
    kind: "connect",
    target: entry,
    from: await portRef(page, "reads", "out"),
    to: await portRef(page, "ALIGN@1", "sample"),
  });
  await applyThroughStore(page, {
    kind: "disconnect",
    target: entry,
    port: await portRef(page, "ALIGN@1", "sample"),
  });
  const view = await portRef(page, ".view@1", "in");
  await applyThroughStore(page, {
    kind: "deleteNode",
    target: entry,
    node: view.node,
  });
  await applyThroughStore(page, {
    kind: "connect",
    target: entry,
    from: await portRef(page, "more", "out"),
    to: await portRef(page, "ALIGN@1", "sample"),
  });
  await undoCountIs(page, 5);
  const editedStored = await storedFiles(page);
  const titles: string[] = [];
  for (let left = 4; left >= 0; left--) {
    const top = (await historyStatus(page)).undo;
    await expect(button(page, "Undo")).toHaveAttribute(
      "title",
      new RegExp(`^Undo: ${top} \\(`),
    );
    titles.push(top ?? "");
    await button(page, "Undo").click();
    await undoCountIs(page, left);
  }
  expect(titles).toEqual([
    "Connect",
    "Delete node",
    "Disconnect",
    "Connect",
    "Add call to ALIGN",
  ]);
  await expect(button(page, "Undo")).toBeDisabled();
  expect(await storedFiles(page)).toEqual(startStored);
  for (let done = 1; done <= 5; done++) {
    await button(page, "Redo").click();
    await redoCountIs(page, 5 - done);
  }
  await expect(button(page, "Redo")).toBeDisabled();
  expect(await storedFiles(page)).toEqual(editedStored);
});

test("F-209 UX-70 F-208: Ctrl+Z inside the code editor undoes typing locally and doesn't undo the project's last command", async ({
  page,
}) => {
  await openSplit(page, "Editor undo");
  await applyThroughStore(page, {
    kind: "addCall",
    target: entry,
    callee: "ALIGN",
  });
  await undoCountIs(page, 1);
  await expect(editor(page)).toContainText("ALIGN()");
  await typeComment(page, "// typed locally");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  await undoCountIs(page, 2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).not.toContainText("typed locally");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  // the local undo is a new project step, and the ALIGN call stays
  await undoCountIs(page, 3);
  expect((await historyStatus(page)).undo).toBe("Edit main.nf");
  const text = await readFile(page, "main.nf");
  expect(text).toContain("ALIGN(");
  expect(text).not.toContain("typed locally");
});

test("F-209 IO-01: an undo survives a reload; the history doesn't", async ({
  page,
}) => {
  await openStoredFixture(page, "Reload");
  const startStored = await storedFiles(page);
  await applyThroughStore(page, {
    kind: "addCall",
    target: entry,
    callee: "ALIGN",
  });
  await undoCountIs(page, 1);
  await storedFiles(page);
  await pressUndo(page);
  await undoCountIs(page, 0);
  expect(await storedFiles(page)).toEqual(startStored);
  await page.reload();
  await canvasReady(page);
  await expect
    .poll(() => readFile(page, "main.nf"), { timeout: 15_000 })
    .toBe(readProject(HISTORY_FIXTURE).find((f) => f.path === "main.nf")?.text);
  await expect(button(page, "Undo")).toBeDisabled();
  await expect(button(page, "Redo")).toBeDisabled();
});
