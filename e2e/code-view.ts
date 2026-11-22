// Helpers for the Code view end-to-end tests (F-208).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  initialJsFiles,
  type Manifest,
} from "../scripts/check-bundle-budget.ts";
import { REPO_ROOT, WEB_DIST } from "../scripts/check-common.ts";
import { openProject } from "./canvas.ts";
import { readProject } from "./engine.ts";
import { E2E_BASE_PATH } from "./urls.ts";

/** A message only Monaco's core contains (the worker-loading error). */
export const MONACO_MARKER =
  "MonacoEnvironment.getWorkerUrl or MonacoEnvironment.getWorker";

/** The built JavaScript files outside the initial load, as `assets/...` paths. */
export function lazyJsFiles(): { initial: string[]; lazy: string[] } {
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = initialJsFiles(manifest, html, E2E_BASE_PATH);
  const lazy = readdirSync(join(WEB_DIST, "assets"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `assets/${f}`)
    .filter((f) => !initial.includes(f));
  return { initial, lazy };
}

/** The lazy files that hold Monaco's core. */
export const monacoChunks = (): string[] =>
  lazyJsFiles().lazy.filter((f) =>
    readFileSync(join(WEB_DIST, f), "utf8").includes(MONACO_MARKER),
  );

export const F208_BEFORE = join(REPO_ROOT, "tools/oracle/cases/f208-code-edit");
export const F208_AFTER = join(
  REPO_ROOT,
  "tools/oracle/cases/f208-code-edit-after",
);

/** The Monaco editor of the open code view. */
export const editor = (page: Page): Locator => page.locator(".monaco-editor");

/** Opens the f208 project (before the valid edit) in the UI. */
export const openCodeFixture = (page: Page) =>
  openProject(page, readProject(F208_BEFORE));

/** Puts the cursor at the end of 1-based `line` and starts a new line holding `text` (the editor keeps the indent). */
export async function insertAfterLine(
  page: Page,
  line: number,
  text: string,
): Promise<void> {
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+Home");
  for (let i = 1; i < line; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(text);
}

/** Types `text` at the end of 1-based `line`. */
export async function appendToLine(
  page: Page,
  line: number,
  text: string,
): Promise<void> {
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+Home");
  for (let i = 1; i < line; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.insertText(text);
}

/** 1-based number of the first line of `main.nf` that equals `line`. */
export function lineNumberOf(dir: string, line: string): number {
  const text = readFileSync(join(dir, "main.nf"), "utf8");
  return text.split("\n").indexOf(line) + 1;
}

export const GREETED_LINE = "    greeted = GREET(names)";

export const fileText = (dir: string): string =>
  readFileSync(join(dir, "main.nf"), "utf8");

export const readFileIn = (page: Page, path: string): Promise<string | null> =>
  page.evaluate(
    (p) =>
      (
        window as unknown as {
          nfBuilderEngine: { readFile(path: string): Promise<string | null> };
        }
      ).nfBuilderEngine.readFile(p),
    path,
  );

/** The ids of the nodes drawn on the canvas, sorted. */
export const canvasIds = async (page: Page): Promise<string[]> =>
  (
    await page
      .locator(".react-flow__node")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-id") ?? ""))
  ).sort();
