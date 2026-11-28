// Helpers for the undo and redo end-to-end tests (F-209). The workspace hook is `window.nfBuilderWorkspace`.
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { canvasReady, clickEmptyCanvas, layoutSettled } from "./canvas.ts";
import { editor } from "./code-view.ts";
import { readProject } from "./engine.ts";
import {
  createProjectInUi,
  readFile,
  readStoredDatabase,
  saveState,
  switcher,
  type WorkspaceHook,
} from "./projects.ts";

/** Already oracle-clean (F-111): typed, with ALIGN, COUNT and PAIR included and unused. */
export const HISTORY_FIXTURE = join(
  REPO_ROOT,
  "tools/oracle/cases/f111-start-typed",
);

/**
 * Files the engine can hold that the store doesn't yet: where `createProcess` REPORT puts its module, and the layout
 * sidecar (F-207), so a save still to land is waited for.
 */
const CREATED = ["modules/local/report/main.nf", ".nf-builder/layout.json"];

export interface HistoryStatus {
  undo: string | null;
  redo: string | null;
  undoCount: number;
  redoCount: number;
}

interface Hook {
  apply(
    command: unknown,
    options?: { group?: string; label?: string },
  ): Promise<{
    ok: boolean;
    message?: string;
  }>;
  history(): HistoryStatus;
}

export const historyStatus = (page: Page): Promise<HistoryStatus> =>
  page.evaluate(() =>
    (
      window as unknown as { nfBuilderWorkspace: Hook }
    ).nfBuilderWorkspace.history(),
  );

/** Applies `command` through the store, the single path of the UI, and fails if it is refused. */
export async function applyThroughStore(
  page: Page,
  command: unknown,
  options?: { group?: string; label?: string },
): Promise<void> {
  const outcome = await page.evaluate(
    ({ command, options }) =>
      (
        window as unknown as { nfBuilderWorkspace: Hook }
      ).nfBuilderWorkspace.apply(command, options),
    { command, options },
  );
  if (!outcome.ok)
    throw new Error(`the command was refused: ${outcome.message}`);
}

/** The reference of a port of the entry workflow's node whose id ends in `/<local>`, from the engine's projection. */
export function portRef(
  page: Page,
  local: string,
  port: string,
): Promise<{ node: string; port: string }> {
  return page.evaluate(
    async ({ local, port }) => {
      const engine = (
        window as unknown as {
          nfBuilderEngine: {
            project(
              path: string,
              workflow: string | null,
            ): Promise<{ projection: { nodes: { id: string }[] } }>;
          };
        }
      ).nfBuilderEngine;
      const result = await engine.project("main.nf", null);
      const found = result.projection.nodes.find((n) =>
        n.id.endsWith(`/${local}`),
      );
      if (!found) throw new Error(`no node ${local}`);
      return { node: found.id, port };
    },
    { local, port },
  );
}

/** The engine's text of each of `paths` that exists. */
export async function engineFiles(
  page: Page,
  paths: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of [...paths].sort()) {
    const text = await readFile(page, path);
    if (text !== null) out[path] = text;
  }
  return out;
}

const storedNow = async (page: Page): Promise<Record<string, string>> => {
  const db = await readStoredDatabase(page);
  const records = (db.stores.files?.records ?? []) as {
    path: string;
    text: string;
  }[];
  return Object.fromEntries(
    records
      .map((r) => [r.path, r.text] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
};

/** Every stored file of the open project once the store holds what the engine holds (the debounced save has landed). */
export async function storedFiles(page: Page): Promise<Record<string, string>> {
  await expect(saveState(page)).toHaveText("Saved");
  await expect
    .poll(
      async () => {
        const stored = await storedNow(page);
        const engine = await engineFiles(page, [
          ...Object.keys(stored),
          ...CREATED,
        ]);
        return JSON.stringify(stored) === JSON.stringify(engine);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return storedNow(page);
}

/** Every file of the engine's open project, from the stored paths and the one `createProcess` REPORT adds. */
export async function currentFiles(
  page: Page,
): Promise<Record<string, string>> {
  const stored = await storedNow(page);
  return engineFiles(page, [...Object.keys(stored), ...CREATED]);
}

/** Creates a stored project, writes the fixture into it and waits until it is saved with the canvas drawn. */
export async function openStoredFixture(
  page: Page,
  name: string,
  dir: string = HISTORY_FIXTURE,
): Promise<void> {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, name);
  const files = readProject(dir);
  await page.evaluate(async (files) => {
    await (
      window as unknown as { nfBuilderEngine: WorkspaceHook }
    ).nfBuilderEngine.writeFiles(files);
  }, files);
  await canvasReady(page);
  // the first layout run writes the sidecar; the start state includes it
  await layoutSettled(page);
  await storedFiles(page);
}

/** Types a new last line `text` into the open code view. */
export async function typeComment(page: Page, text: string): Promise<void> {
  await expect(editor(page)).toBeVisible();
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(text);
}

/** Presses the undo shortcut with the canvas focused (never the editor, which keeps its own). */
export async function pressUndo(page: Page): Promise<void> {
  await clickEmptyCanvas(page);
  await page.keyboard.press("ControlOrMeta+z");
}

export async function pressRedo(page: Page): Promise<void> {
  await clickEmptyCanvas(page);
  await page.keyboard.press("ControlOrMeta+Shift+z");
}
