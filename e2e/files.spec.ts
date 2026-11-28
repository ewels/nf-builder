import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { SMOKE_TAG, VISUAL_TAG } from "./browsers.ts";
import {
  canvasReady,
  expectBaseline,
  layoutSettled,
  openFixture,
} from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import {
  addDialog,
  confirmAdd,
  createInFiles,
  type DropFile,
  dropCancelled,
  dropFiles,
  dropFolder,
  engineFileList,
  expandPath,
  F210_BROKEN,
  filesPanel,
  showFiles,
  treeRow,
  uploadFiles,
  visiblePaths,
} from "./files.ts";
import { historyStatus } from "./history.ts";
import {
  createProjectInUi,
  readFile,
  readStoredDatabase,
  saveState,
  switcher,
} from "./projects.ts";
import { writeZip } from "./zips.ts";

const csv = (name: string, text = "a,b\n1,2\n"): DropFile => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(text),
});

/** A zip file of `files`, as the bytes a drop carries. */
function zipOf(
  testInfo: { outputPath(name: string): string },
  name: string,
  files: Record<string, string>,
  level: 0 | 1 | 6 = 6,
): DropFile {
  const path = testInfo.outputPath(name);
  writeZip(files, path, level);
  return {
    name,
    mimeType: "application/zip",
    buffer: readFileSync(path),
  };
}

const undoButton = (page: Page) =>
  page.getByRole("button", { name: "Undo", exact: true });

/** A new stored project with the Files view shown. */
async function blankProject(page: Page, name: string): Promise<void> {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, name);
  await showFiles(page);
}

/** The stored files of the one project, as path to text. */
async function storedTexts(page: Page): Promise<Record<string, string>> {
  const db = await readStoredDatabase(page);
  const records = (db.stores.files?.records ?? []) as {
    path: string;
    text: string;
  }[];
  return Object.fromEntries(records.map((r) => [r.path, r.text]));
}

const EXTRA_MAIN = 'process EXTRA {\n    script:\n    "echo extra"\n}\n';

test("F-210 step 1 UX-16 IO-01 QA-30: a file and a folder created from the Files view, an uploaded file and a dropped zip appear in the tree and persist after reload", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  const watch = await watchForCspViolations(page);
  await blankProject(page, "files-one");
  await createInFiles(page, "file", "notes.txt");
  await expect(treeRow(page, "notes.txt")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(filesPanel(page).getByRole("status")).toHaveText(
    "Created notes.txt.",
  );
  await createInFiles(page, "folder", "assets");
  await expect(treeRow(page, "assets")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // the selected folder is where Upload puts the file
  await uploadFiles(page, [csv("samplesheet.csv")]);
  await expect(addDialog(page)).toContainText("To assets/");
  await confirmAdd(page);
  await expandPath(page, "assets/samplesheet.csv");
  await expect(treeRow(page, "assets/.gitkeep")).toBeVisible();
  // a zip dropped on the empty space of the tree goes to the top
  const zip = zipOf(testInfo, "extra.zip", {
    "extra-main/modules/local/extra/main.nf": EXTRA_MAIN,
    "extra-main/docs/usage.md": "# Usage\n",
  });
  await dropFiles(page, filesPanel(page).locator(".files-hint"), [zip]);
  await expect(addDialog(page)).toContainText("Add files from extra.zip");
  await expect(addDialog(page)).toContainText("To the top of the project");
  await confirmAdd(page);
  await expect(filesPanel(page).getByRole("status")).toContainText(
    "Added 2 files to the top of the project.",
  );
  await expect(saveState(page)).toHaveText("Saved");
  await page.reload();
  await expect(switcher(page)).toBeEnabled();
  await showFiles(page);
  for (const path of [
    "notes.txt",
    "assets/.gitkeep",
    "assets/samplesheet.csv",
    "modules/local/extra/main.nf",
    "docs/usage.md",
  ])
    await expandPath(page, path);
  const stored = await storedTexts(page);
  expect(stored["notes.txt"]).toBe("");
  expect(stored["assets/.gitkeep"]).toBe("");
  expect(stored["assets/samplesheet.csv"]).toBe("a,b\n1,2\n");
  expect(stored["modules/local/extra/main.nf"]).toBe(EXTRA_MAIN);
  expect(stored["docs/usage.md"]).toBe("# Usage\n");
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-210 step 2 UX-16 QA-12: a registry module folder shows the registry tag and a file with a syntax error shows an error badge", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await showFiles(page);
  const broken = readFileSync(F210_BROKEN, "utf8");
  const write = (files: { path: string; text: string }[]) =>
    page.evaluate(async (files) => {
      await (
        window as unknown as {
          nfBuilderEngine: {
            writeFiles(f: { path: string; text: string }[]): Promise<unknown>;
          };
        }
      ).nfBuilderEngine.writeFiles(files);
    }, files);
  await write([{ path: "broken.nf", text: broken }]);
  await expandPath(page, "modules/nf-core/wordcount");
  await expandPath(page, "modules/local/greet");
  const tag = treeRow(page, "modules/nf-core/wordcount").locator(".file-tag");
  await expect(tag).toHaveText("registry");
  await expect(tag).toHaveAttribute(
    "title",
    "Registry module nf-core/wordcount",
  );
  await expect(
    treeRow(page, "modules/local/greet").locator(".file-tag"),
  ).toHaveCount(0);
  const list = await engineFileList(page);
  expect(list.registry).toEqual([
    { path: "modules/nf-core/wordcount", module: "nf-core/wordcount" },
  ]);
  const badge = (path: string) => treeRow(page, path).locator(".file-badge");
  await expect(badge("broken.nf")).toBeVisible();
  await expect(badge("broken.nf")).toContainText(/parse error/);
  await expect(badge("main.nf")).toHaveCount(0);
  // a syntax error written into main.nf adds its badge; the original text takes it away
  const original = (await readFile(page, "main.nf")) as string;
  await write([{ path: "main.nf", text: broken }]);
  await expect(badge("main.nf")).toBeVisible();
  await write([{ path: "main.nf", text: original }]);
  await expect(badge("main.nf")).toHaveCount(0);
});

test(
  `F-210 UX-16 QA-20: dropping a small zip and uploading a file add them to the tree ${SMOKE_TAG}`,
  { tag: SMOKE_TAG },
  async ({ page }, testInfo) => {
    await blankProject(page, "files-smoke");
    const zip = zipOf(testInfo, "small.zip", {
      "x/one.txt": "one\n",
      "x/two.txt": "two\n",
    });
    // Firefox's page crashes when Playwright dispatches drag events carrying a synthetic DataTransfer with Files (a
    // Playwright/Firefox limitation, not the app's), so the drop path runs on Chromium; Firefox and WebKit take the
    // same zip through the Upload input, which reaches the same Add files dialog.
    if (testInfo.project.name === "chromium")
      await dropFiles(page, filesPanel(page).locator(".files-hint"), [zip]);
    else await uploadFiles(page, [zip]);
    await confirmAdd(page);
    await expect(treeRow(page, "one.txt")).toBeVisible();
    await expect(treeRow(page, "two.txt")).toBeVisible();
    await uploadFiles(page, [csv("up.csv")]);
    await confirmAdd(page);
    await expect(treeRow(page, "up.csv")).toBeVisible();
    expect(await readFile(page, "up.csv")).toBe("a,b\n1,2\n");
  },
);

test("F-210 AR-23 ADR-0051: New file and New folder are one undo step each; adding files clears the undo history", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blankProject(page, "files-undo");
  const before = (await historyStatus(page)).undoCount;
  await createInFiles(page, "file", "a.txt");
  await expect(undoButton(page)).toHaveAttribute(
    "title",
    /^Undo: Create a\.txt \(/,
  );
  await createInFiles(page, "folder", "d");
  await expect(undoButton(page)).toHaveAttribute(
    "title",
    /^Undo: Create folder d \(/,
  );
  expect((await historyStatus(page)).undoCount).toBe(before + 2);
  await expandPath(page, "d/.gitkeep");
  await undoButton(page).click();
  await expect(treeRow(page, "d")).toHaveCount(0);
  await expect(treeRow(page, "a.txt")).toBeVisible();
  // a.txt is open in a tab; undoing its creation closes the tab with the file
  await expect(page.getByRole("tab", { name: "a.txt" })).toBeVisible();
  await undoButton(page).click();
  await expect(treeRow(page, "a.txt")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "a.txt" })).toHaveCount(0);
  expect((await historyStatus(page)).undoCount).toBe(before);
  // adding files can't be undone and clears the history
  await createInFiles(page, "file", "b.txt");
  expect((await historyStatus(page)).undoCount).toBe(before + 1);
  await uploadFiles(page, [csv("c.csv")]);
  await expect(addDialog(page)).toContainText(
    "Adding files can't be undone, and it clears the undo history.",
  );
  await confirmAdd(page);
  await expect(treeRow(page, "c.csv")).toBeVisible();
  expect((await historyStatus(page)).undoCount).toBe(0);
  await expect(undoButton(page)).toBeDisabled();
});

test("F-210 UX-16 QA-10: the New file dialog shows the check's message inline as you type and disables Create", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blankProject(page, "files-inline");
  await createInFiles(page, "file", "a.txt");
  await filesPanel(page).getByRole("button", { name: "New file" }).click();
  const dialog = page.getByRole("dialog", { name: "New file" });
  await dialog.getByLabel("Name").fill("a.txt");
  await expect(dialog.getByRole("alert")).toHaveText("a.txt already exists.");
  await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
  await dialog.getByLabel("Name").fill("b.txt");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Create" })).toBeEnabled();
});

test("F-210 UX-70 QA-10: the tree works by keyboard (arrows, Right and Left, Home and End, Enter, type-ahead) and the three actions are reachable with Tab", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await showFiles(page);
  await expect(treeRow(page, ".nf-builder")).toBeVisible();
  // the actions come first in the panel's tab order, then the tree's one tab stop
  await page.getByRole("tab", { name: "Files" }).focus();
  await page.keyboard.press("Tab"); // the column's collapse button
  for (const name of ["New file", "New folder", "Upload files"]) {
    await page.keyboard.press("Tab");
    await expect(filesPanel(page).getByRole("button", { name })).toBeFocused();
  }
  await page.keyboard.press("Tab");
  const paths = await visiblePaths(page);
  expect(paths).toEqual([
    "legacy.nf",
    "main.nf",
    "workflows.nf",
    ".nf-builder", // the layout sidecar the canvas wrote
    "data",
    "modules",
    "pipelines",
  ]);
  await expect(treeRow(page, "legacy.nf")).toBeFocused();
  await expect(treeRow(page, "legacy.nf")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowDown");
  await expect(treeRow(page, "main.nf")).toBeFocused();
  await page.keyboard.press("End");
  await expect(treeRow(page, "pipelines")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(treeRow(page, "pipelines")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(treeRow(page, "legacy.nf")).toBeFocused();
  // type-ahead, and G, S and C stay inert while the tree has focus
  await page.keyboard.type("mo");
  await expect(treeRow(page, "modules")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(treeRow(page, "modules")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("ArrowRight");
  await expect(treeRow(page, "modules/local")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(treeRow(page, "modules")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(treeRow(page, "modules")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.keyboard.press("Enter");
  await expect(treeRow(page, "modules")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("c");
  await expect(page.locator("#canvas-panel")).toHaveAttribute(
    "data-view-mode",
    "graph",
  );
  // Enter opens a file and leaves focus in the tree
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(treeRow(page, "main.nf")).toBeFocused();
  await expect(page.getByRole("tab", { name: "main.nf" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("F-210 UX-20 UX-52 IO-02: a script with a workflow opens its canvas tab, README.md opens a code-only tab with a close button, and .nf-builder/layout.json opens read-only", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await layoutSettled(page);
  await page.evaluate(async () => {
    await (
      window as unknown as {
        nfBuilderEngine: {
          writeFiles(f: { path: string; text: string }[]): Promise<unknown>;
        };
      }
    ).nfBuilderEngine.writeFiles([{ path: "README.md", text: "# Demo\n" }]);
  });
  await showFiles(page);
  const tabs = page.getByRole("tablist", { name: "Open workflows and files" });
  await treeRow(page, "workflows.nf").click();
  await expect(tabs.getByRole("tab", { name: "SHOUT" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await treeRow(page, "README.md").click();
  const readme = tabs.getByRole("tab", { name: "README.md" });
  await expect(readme).toHaveAttribute("aria-selected", "true");
  await expect(readme).toHaveAttribute("title", "README.md");
  await expect(page.locator(".code-pane-path")).toHaveText("README.md");
  await expect(page.getByRole("radiogroup", { name: "View mode" })).toHaveCount(
    0,
  );
  // the sidecar the layout wrote is listed and opens read-only
  await expect(treeRow(page, ".nf-builder")).toBeVisible();
  await expandPath(page, ".nf-builder/layout.json");
  await treeRow(page, ".nf-builder/layout.json").click();
  await expect(page.locator(".code-pane-readonly")).toHaveText(
    "Read-only: nf-builder keeps .nf-builder/ up to date itself.",
  );
  const sidecar = await readFile(page, ".nf-builder/layout.json");
  const lines = page.locator(".monaco-editor .view-lines");
  const shown = await lines.textContent();
  await lines.click();
  await page.keyboard.type("x");
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(500);
  // the editor itself refused the keystroke
  await expect(lines).toHaveText(shown as string);
  expect(await readFile(page, ".nf-builder/layout.json")).toBe(sidecar);
  // closing tabs: the active one goes, the previous one takes over
  await page.getByRole("button", { name: "Close layout.json" }).click();
  await expect(tabs.getByRole("tab", { name: "layout.json" })).toHaveCount(0);
  await expect(readme).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Close README.md" }).click();
  await expect(readme).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "SHOUT" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("F-210 UX-16 IO-12 QA-32: a dropped zip with more than 20,000 entries is refused with F-403's message and nothing is written", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await blankProject(page, "files-many");
  const before = await visiblePaths(page);
  const entries: Record<string, string> = {};
  for (let i = 0; i <= 20_000; i += 1) entries[`many/f${i}.txt`] = "";
  const zip = zipOf(testInfo, "many.zip", entries, 0);
  await dropFiles(page, filesPanel(page).locator(".files-hint"), [zip]);
  await expect(filesPanel(page).getByRole("alert")).toHaveText(
    "This zip has more than 20,000 files and folders. Imports take up to 20,000.",
  );
  await expect(addDialog(page)).toHaveCount(0);
  expect(await visiblePaths(page)).toEqual(before);
  expect(
    Object.keys(await storedTexts(page)).some((p) => p.startsWith("many/")),
  ).toBe(false);
});

test("F-210 UX-16: dropping a folder is refused with a message, and a file dropped on the canvas doesn't navigate away", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await showFiles(page);
  const url = page.url();
  const listed = ((await engineFileList(page)).files ?? [])
    .map((f) => f.path)
    .sort();
  await dropFolder(page, filesPanel(page).locator(".files-hint"));
  await expect(filesPanel(page).getByRole("alert")).toHaveText(
    "Folders can't be dropped. Drop the files in it, or a zip of the folder.",
  );
  await expect(addDialog(page)).toHaveCount(0);
  const cancelled = await dropCancelled(page, page.locator(".canvas-area"), [
    csv("stray.csv"),
  ]);
  expect(cancelled).toBe(true);
  expect(page.url()).toBe(url);
  await expect(page.locator(".workflow-canvas")).toBeVisible();
  // no file was added by either drop
  expect(
    ((await engineFileList(page)).files ?? []).map((f) => f.path).sort(),
  ).toEqual(listed);
});

test(
  "F-210 UX-16 @visual: the Files view with a registry folder and a failed file matches its baseline",
  { tag: VISUAL_TAG },
  async ({ page }, testInfo) => {
    await page.goto("./");
    await openFixture(page);
    await canvasReady(page);
    await page.evaluate(
      async (text) => {
        await (
          window as unknown as {
            nfBuilderEngine: {
              writeFiles(f: { path: string; text: string }[]): Promise<unknown>;
            };
          }
        ).nfBuilderEngine.writeFiles([{ path: "broken.nf", text }]);
      },
      readFileSync(F210_BROKEN, "utf8"),
    );
    await showFiles(page);
    await expandPath(page, "modules/nf-core/wordcount");
    await expandPath(page, "modules/local/greet");
    await expect(
      treeRow(page, "broken.nf").locator(".file-badge"),
    ).toBeVisible();
    await expectBaseline(page, testInfo, "files-view-registry-error.png", {
      target: page.locator("#column-left"),
    });
  },
);
