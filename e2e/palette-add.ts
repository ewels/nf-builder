// Helpers for the palette add end-to-end tests (F-301): palette items by name, a real drag onto the canvas, and the
// canvas's geometry.
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { readProject } from "./engine.ts";
import { storedFiles } from "./history.ts";

export interface Point {
  x: number;
  y: number;
}

/** The oracle case the blank template plus a palette process and workflow must equal (CI lints and stub-runs it). */
export const PALETTE_ADDS_CASE = join(
  REPO_ROOT,
  "tools/oracle/cases/f301-palette-adds",
);

export const palettePanel = (page: Page): Locator =>
  page.getByRole("tabpanel", { name: "Components" });

/** The live region that says what an add did. */
export const addStatus = (page: Page): Locator =>
  palettePanel(page).locator(".palette-add-status");

export const paletteItem = (page: Page, label: string): Locator =>
  palettePanel(page).getByRole("button", { name: label, exact: true });

const canvasHost = (page: Page): Locator => page.locator(".workflow-canvas");

/** The centre of the canvas, in client coordinates. */
export async function paneCentre(page: Page): Promise<Point> {
  const box = await canvasHost(page).boundingBox();
  if (box === null) throw new Error("no canvas");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags a palette item onto the canvas, `at` pixels from its top-left corner. */
export async function dragToCanvas(
  page: Page,
  label: string,
  at: Point,
): Promise<Point> {
  const box = await canvasHost(page).boundingBox();
  if (box === null) throw new Error("no canvas");
  await paletteItem(page, label).dragTo(canvasHost(page), {
    targetPosition: at,
  });
  return { x: box.x + at.x, y: box.y + at.y };
}

/** The viewport's transform, which a fit changes. */
export const viewportTransform = (page: Page): Promise<string> =>
  page
    .locator(".react-flow__viewport")
    .evaluate((el) => getComputedStyle(el).transform);

/** The box of a node on screen, once it is there. */
export async function nodeBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page
    .locator(`.react-flow__node[data-id="${id}"]`)
    .boundingBox();
  if (box === null) throw new Error(`${id} isn't on screen`);
  return box;
}

export function expectBoxContains(
  box: { x: number; y: number; width: number; height: number },
  point: Point,
): void {
  expect(point.x).toBeGreaterThanOrEqual(box.x);
  expect(point.x).toBeLessThanOrEqual(box.x + box.width);
  expect(point.y).toBeGreaterThanOrEqual(box.y);
  expect(point.y).toBeLessThanOrEqual(box.y + box.height);
}

/** The stored files of the open project apart from the layout sidecar, as path to text. */
export async function projectFiles(
  page: Page,
): Promise<Record<string, string>> {
  const all = await storedFiles(page);
  return Object.fromEntries(
    Object.entries(all).filter(([path]) => !path.startsWith(".nf-builder/")),
  );
}

/** The files of `PALETTE_ADDS_CASE` as path to text. */
export const caseFiles = (): Record<string, string> =>
  Object.fromEntries(
    readProject(PALETTE_ADDS_CASE)
      .map((f) => [f.path, f.text] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
