// Helpers for the layout end-to-end tests (F-207): a stored project (F-202) opened through the engine hook, node
// positions read from the DOM, and the sidecar read back from the engine and from IndexedDB.
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { canvasReady, node } from "./canvas.ts";
import { readProject } from "./engine.ts";
import {
  readFile,
  readStoredDatabase,
  saveState,
  switcher,
} from "./projects.ts";

const LAYOUT_FIXTURE = join(REPO_ROOT, "tools/oracle/cases/f111-start-typed");
export const SIDECAR = ".nf-builder/layout.json";

/** The node ids of the fixture's entry workflow (projection keys, ADR 0036). */
export const KEY = {
  reads: "main.nf#/reads",
  more: "main.nf#/more",
  fromPath: "main.nf#/channel.fromPath@1",
  view: "main.nf#/.view@1",
  count: "main.nf#/COUNT@1",
  tally: "main.nf#/TALLY@1",
} as const;

interface Point {
  x: number;
  y: number;
}

/** A stored project from `LAYOUT_FIXTURE` plus `extra` files, opened by a reload: the app reopens the latest project. */
export async function openStoredProject(
  page: Page,
  extra: { path: string; text: string }[] = [],
): Promise<void> {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const version = await page.getByLabel("Nextflow version").inputValue();
  const files = [...readProject(LAYOUT_FIXTURE), ...extra];
  await page.evaluate(
    async ({ files, version }) => {
      const engine = (
        window as unknown as {
          nfBuilderEngine: {
            createProject(input: {
              name: string;
              languageVersion: string;
              files: { path: string; text: string }[];
            }): Promise<{ id: string }>;
          };
        }
      ).nfBuilderEngine;
      await engine.createProject({
        name: "Layout",
        languageVersion: version,
        files,
      });
    },
    { files, version },
  );
  await page.reload();
  await canvasReady(page);
}

/** A node's top-left corner in flow coordinates, from its transform. */
export function nodePosition(page: Page, id: string): Promise<Point> {
  return node(page, id).evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42 };
  });
}

interface Box extends Point {
  id: string;
  width: number;
  height: number;
}

/** Every node's box on screen. A uniform zoom keeps overlaps and left-to-right order as they are in the flow. */
export function nodeBoxes(page: Page): Promise<Box[]> {
  return page.locator(".react-flow__node").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-id") ?? "",
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }),
  );
}

export function overlaps(boxes: readonly Box[]): [string, string][] {
  const found: [string, string][] = [];
  for (const a of boxes)
    for (const b of boxes) {
      if (a.id >= b.id) continue;
      if (
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      )
        found.push([a.id, b.id]);
    }
  return found;
}

/** Drags a node by its title bar. */
export async function dragNode(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  const title = node(page, id).locator(".canvas-node-title").first();
  const box = await title.boundingBox();
  if (box === null) throw new Error(`${id} has no title box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

interface Sidecar {
  version: number;
  nodes: Record<string, Point>;
}

/** The sidecar in the open project, or null when there is none. */
export async function readSidecar(page: Page): Promise<Sidecar | null> {
  const text = await readFile(page, SIDECAR);
  return text === null ? null : (JSON.parse(text) as Sidecar);
}

/** Waits for "Saved" in the header, then returns the sidecar's text as IndexedDB holds it. */
export async function waitSaved(page: Page): Promise<string | null> {
  await expect(saveState(page)).toHaveText("Saved");
  const db = await readStoredDatabase(page);
  const files = (db.stores.files?.records ?? []) as {
    path: string;
    text: string;
  }[];
  return files.find((f) => f.path === SIDECAR)?.text ?? null;
}
