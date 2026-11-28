// Helpers for the Files view end-to-end tests (F-210). The engine hook is `window.nfBuilderEngine`.
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import type { EngineHook } from "./engine.ts";

/** Malformed on purpose: a syntax error in one process, so the file fails to parse completely. */
export const F210_BROKEN = join(
  REPO_ROOT,
  "tools/corpus/fixtures/bad-declaration.nf",
);

export interface DropFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const filesTab = (page: Page): Locator =>
  page.getByRole("tab", { name: "Files" });

export const filesPanel = (page: Page): Locator =>
  page.getByRole("tabpanel", { name: "Files" });

/** The tree row of `path` (collapsed folders hide their children). */
export const treeRow = (page: Page, path: string): Locator =>
  filesPanel(page).locator(`[role="treeitem"][data-path="${path}"]`);

/** Shows the Files view. */
export async function showFiles(page: Page): Promise<void> {
  await filesTab(page).click();
  await expect(filesPanel(page)).toBeVisible();
}

/** Expands every folder above `path`. */
export async function expandPath(page: Page, path: string): Promise<void> {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const row = treeRow(page, parts.slice(0, i).join("/"));
    await expect(row).toBeVisible();
    if ((await row.getAttribute("aria-expanded")) === "false")
      await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
  }
  await expect(treeRow(page, path)).toBeVisible();
}

/** The paths of the visible rows, in tree order. */
export const visiblePaths = (page: Page): Promise<string[]> =>
  filesPanel(page)
    .locator('[role="treeitem"]')
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset.path ?? ""),
    );

/** New file or New folder: opens the dialog, fills the name and creates. */
export async function createInFiles(
  page: Page,
  kind: "file" | "folder",
  name: string,
): Promise<void> {
  await filesPanel(page)
    .getByRole("button", { name: kind === "file" ? "New file" : "New folder" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: kind === "file" ? "New file" : "New folder",
  });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await dialog.waitFor({ state: "hidden" });
}

/** Chooses files in the Upload files input. */
export async function uploadFiles(
  page: Page,
  files: DropFile[],
): Promise<void> {
  await filesPanel(page).locator('input[type="file"]').setInputFiles(files);
}

/** A `DataTransfer` holding `files`, built in the page. */
async function dataTransfer(page: Page, files: DropFile[]) {
  const data = files.map((f) => ({
    name: f.name,
    type: f.mimeType,
    base64: f.buffer.toString("base64"),
  }));
  return page.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    for (const f of data) {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      transfer.items.add(new File([bytes], f.name, { type: f.type }));
    }
    return transfer;
  }, data);
}

/** Drops `files` on `target`: dragenter, dragover and drop with a real `DataTransfer`. */
export async function dropFiles(
  page: Page,
  target: Locator,
  files: DropFile[],
): Promise<void> {
  const transfer = await dataTransfer(page, files);
  for (const type of ["dragenter", "dragover", "drop"])
    await target.dispatchEvent(type, { dataTransfer: transfer });
}

/** Drops `files` on `target` and says whether the page cancelled the drop (so the browser doesn't open the file). */
export async function dropCancelled(
  page: Page,
  target: Locator,
  files: DropFile[],
): Promise<boolean> {
  const transfer = await dataTransfer(page, files);
  return target.evaluate((element, transfer) => {
    const event = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, transfer);
}

/** Drops something the browser says is a folder (`webkitGetAsEntry().isDirectory`), which a script can't build for real. */
export async function dropFolder(page: Page, target: Locator): Promise<void> {
  await target.evaluate((element) => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        types: ["Files"],
        files: [new File([""], "assets")],
        items: [
          { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) },
        ],
        dropEffect: "none",
      },
    });
    element.dispatchEvent(event);
  });
  await page.waitForTimeout(0);
}

/** The Add files dialog. */
export const addDialog = (page: Page): Locator =>
  page.getByRole("dialog", { name: /^Add files/ });

/** Confirms the Add files dialog and waits for it to close. */
export async function confirmAdd(page: Page): Promise<void> {
  const dialog = addDialog(page);
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: /^Add/ }).click();
  await dialog.waitFor({ state: "hidden" });
}

/** The engine's file list, through the test hook. */
export const engineFileList = (page: Page) =>
  page.evaluate(async () => {
    const result = await (
      window as unknown as { nfBuilderEngine: EngineHook }
    ).nfBuilderEngine.listFiles();
    return result;
  });
