// Helpers for the connect end-to-end tests (F-302): handles, a drag that can be inspected half way, and edges.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { node } from "./canvas.ts";
import { readProject } from "./engine.ts";

const CASES = join(REPO_ROOT, "tools/oracle/cases");
/** `DESCRIBE()` has no argument; `TOUCH()` sits beside it (oracle case, LA-29). */
export const F302_START = join(CASES, "f302-connect-start");
/** `DESCRIBE(params.input)`: the same tree with step 1 applied. */
export const F302_TYPED = join(CASES, "f302-connect-typed");
/** `DESCRIBE(touch)`: step 2 applied, one type-mismatch error. */
export const F302_MISMATCH = join(CASES, "f302-connect-mismatch");

export const PARAMS = "main.nf#/:params";
export const TOUCH = "main.nf#/TOUCH@1";
export const DESCRIBE = "main.nf#/DESCRIBE@1";

/** The text of `main.nf` in a fixture tree. */
export function mainOf(dir: string): string {
  const main = readProject(dir).find((f) => f.path === "main.nf");
  if (main === undefined) throw new Error(`${dir} has no main.nf`);
  return main.text;
}

/** A React Flow handle of a node, by its handle id (`in:<port>` or `out:<port>`). */
export const handle = (page: Page, nodeId: string, handleId: string): Locator =>
  node(page, nodeId).locator(
    `.react-flow__handle[data-handleid="${handleId}"]`,
  );

interface End {
  node: string;
  handle: string;
}

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Drags from one handle to another with the mouse. `during` runs while the pointer is over the target and the button
 * is still down, to look at the dimming; the button is released after it.
 */
export async function dragConnection(
  page: Page,
  from: End,
  to: End,
  during?: () => Promise<void>,
): Promise<void> {
  const start = await centreOf(handle(page, from.node, from.handle));
  const end = await centreOf(handle(page, to.node, to.handle));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 4, { steps: 3 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  if (during !== undefined) await during();
  await page.mouse.up();
}

/** The edge into an input port, whichever node feeds it. */
export const edgeInto = (page: Page, nodeId: string, port: string): Locator =>
  page.locator(`.react-flow__edge[data-id$="-> ${nodeId}[${port}]"]`);

/** The screen point of an edge nearest its middle that no node covers: where to click or hover it. */
export function edgeMidpoint(edge: Locator): Promise<{ x: number; y: number }> {
  return edge.locator(".react-flow__edge-path").evaluate((el) => {
    const path = el as unknown as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (matrix === null) throw new Error("the edge has no screen transform");
    const total = path.getTotalLength();
    const owner = path.closest(".react-flow__edge");
    for (let step = 0; step <= 80; step++) {
      const fraction =
        0.5 + (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 0.0125;
      const at = path.getPointAtLength(total * fraction);
      const point = new DOMPoint(at.x, at.y).matrixTransform(matrix);
      const top = document.elementFromPoint(point.x, point.y);
      if (owner !== null && top?.closest(".react-flow__edge") === owner)
        return { x: point.x, y: point.y };
    }
    throw new Error("every point of the edge is covered");
  });
}
