// Helpers for the read-only end-to-end tests (F-703, UX-04): resizing across 1024 px, a stored project opened at a wide
// size first (the version select is hidden below it), and overflow measurements.
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { canvasReady } from "./canvas.ts";
import { readProject } from "./engine.ts";
import { saveState, switcher } from "./projects.ts";

export const PHONE = { width: 390, height: 844 };
export const NARROW = { width: 1000, height: 768 };
export const WIDE = { width: 1440, height: 900 };
export const NOTE_TEXT =
  "Read-only view: editing needs a larger screen or a wider window.";

const CANVAS_FIXTURE = join(REPO_ROOT, "tools/oracle/cases/f205-canvas");

/** The note's text, when it is shown. */
export const readOnlyNote = (page: Page): Locator =>
  page.locator(".read-only-note p");

export const resize = (
  page: Page,
  size: { width: number; height: number },
): Promise<void> => page.setViewportSize(size);

/** At 1440 px: creates a stored project from the f205-canvas fixture, waits until it is saved with its canvas drawn. */
export async function openStoredCanvas(
  page: Page,
  name: string,
): Promise<void> {
  await page.setViewportSize(WIDE);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const version = await page.getByLabel("Nextflow version").inputValue();
  const files = readProject(CANVAS_FIXTURE);
  await page.evaluate(
    async ({ files, version, name }) => {
      await (
        window as unknown as {
          nfBuilderEngine: {
            createProject(input: {
              name: string;
              languageVersion: string;
              files: { path: string; text: string }[];
            }): Promise<unknown>;
          };
        }
      ).nfBuilderEngine.createProject({
        name,
        languageVersion: version,
        files,
      });
    },
    { files, version, name },
  );
  await page.reload();
  await canvasReady(page);
  await expect(saveState(page)).toHaveText("Saved");
}

/** How far the page's content reaches past the viewport sideways, in CSS px (0: nothing scrolls sideways). */
export const horizontalOverflow = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
