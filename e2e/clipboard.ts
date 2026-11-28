// Helpers for the multi-select, delete, copy and paste end-to-end tests (F-310).
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { node } from "./canvas.ts";

const CASES = join(REPO_ROOT, "tools/oracle/cases");
/** MAKE and SIZE, connected, in modules/local (oracle case). */
export const F310_SOURCE = join(CASES, "f310-copy-source");
/** The blank template after both are pasted (oracle case). */
export const F310_TARGET = join(CASES, "f310-paste-across");
/** MAKE, SIZE (fed by MAKE) and an independent STAMP (oracle case). */
export const F310_DELETE_START = join(CASES, "f310-delete-start");
export const F310_DELETE_MULTI = join(CASES, "f310-delete-multi");

export const MAKE = "main.nf#/make";
export const SIZE = "main.nf#/SIZE@1";
export const STAMP = "main.nf#/STAMP@1";

/** Clicks a node's title with Shift held, which adds it to the selection. */
export async function shiftClick(page: Page, id: string): Promise<void> {
  await node(page, id)
    .locator(".canvas-node-title")
    .first()
    .click({ modifiers: ["Shift"] });
}

/** Drags a marquee from `from` to `to` (page coordinates) with Shift held. */
export async function marquee(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

export const pressCopy = (page: Page) => page.keyboard.press("ControlOrMeta+c");
export const pressPaste = (page: Page) =>
  page.keyboard.press("ControlOrMeta+v");

/** The selected nodes' ids, read from the DOM. */
export const selectedNodes = (page: Page): Promise<string[]> =>
  page
    .locator(".react-flow__node.selected")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-id") ?? "").sort(),
    );
