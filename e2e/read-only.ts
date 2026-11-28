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

/** Stores a project from the f205-canvas fixture through the engine hook and reloads, so the app reopens it. */
export async function storeCanvasProject(
  page: Page,
  name: string,
  version: string,
): Promise<void> {
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
}

/** At 1440 px: creates a stored project from the f205-canvas fixture, waits until it is saved with its canvas drawn. */
export async function openStoredCanvas(
  page: Page,
  name: string,
): Promise<void> {
  await page.setViewportSize(WIDE);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const version = await page.getByLabel("Nextflow version").inputValue();
  await storeCanvasProject(page, name, version);
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

/**
 * A descriptor (`role: name`) of every visible control in the app shell, with React Flow's nodes and edges collapsed to
 * `node` and `edge`. The read-only tests check them all against `READ_ONLY_ALLOWED`.
 */
export const visibleControls = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const SELECTOR =
      'button, a[href], input, select, textarea, [role="tab"], [role="radio"], [role="separator"], [tabindex]:not([tabindex="-1"])';
    const shown = (el: Element) => {
      const style = getComputedStyle(el);
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        el.getClientRects().length > 0
      );
    };
    const found = new Set<string>();
    for (const el of document.querySelectorAll(
      `.app-shell ${SELECTOR.replaceAll(", ", ", .app-shell ")}`,
    )) {
      if (!shown(el)) continue;
      if (el.closest(".react-flow__node")) {
        found.add("node");
        continue;
      }
      if (el.closest(".react-flow__edge")) {
        found.add("edge");
        continue;
      }
      if (el.classList.contains("project-switcher-button")) {
        found.add("switcher");
        continue;
      }
      if (el.closest(".breadcrumb") !== null) {
        found.add("breadcrumb");
        continue;
      }
      if (el.classList.contains("problem-go")) {
        found.add("problem");
        continue;
      }
      const name =
        el.getAttribute("aria-label") ??
        el.textContent?.trim() ??
        el.getAttribute("title") ??
        "";
      found.add(
        `${el.getAttribute("role") ?? el.tagName.toLowerCase()}: ${name}`,
      );
    }
    return [...found];
  });

/**
 * What read-only mode may show as a control. A feature that adds a visible control either hides it in read-only mode or
 * adds it here in its own change, so a missing read-only treatment fails the test.
 */
export const READ_ONLY_ALLOWED: readonly RegExp[] = [
  /^node$/,
  /^edge$/,
  /^switcher$/,
  /^breadcrumb$/, // an ancestor in a workflow tab's path: opens a tab (F-307)
  /^tab: /, // the workflow tabs
  /^button: (Zoom in|Zoom out|Fit view|Port labels)$/,
  /^a: React Flow attribution$/,
  // the status bar's problem and suggestion counts open the panel, which only reads
  /^button: .*\b(problems?|suggestions?)$/,
  /^problem$/, // a row of the panel, which goes to its place
  /^button: Close problems panel$/,
];

/** Sends `command` through the store's apply, as the UI does, and reports what came back instead of throwing. */
export function applyOutcome(
  page: Page,
  command: unknown,
): Promise<{ ok: boolean; code?: string; message?: string }> {
  return page.evaluate(
    (command) =>
      (
        window as unknown as {
          nfBuilderWorkspace: {
            apply(c: unknown): Promise<{
              ok: boolean;
              code?: string;
              message?: string;
            }>;
          };
        }
      ).nfBuilderWorkspace.apply(command),
    command,
  );
}
