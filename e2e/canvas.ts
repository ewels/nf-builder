// Helpers for the canvas end-to-end tests (F-205). The workspace hook is `window.nfBuilderWorkspace`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { readProject } from "./engine.ts";

interface WorkspaceHook {
  open(request: {
    version: string;
    files: { path: string; text: string }[];
  }): Promise<unknown>;
  openWorkflow(path: string, workflow: string | null): Promise<void>;
}

const F205_FIXTURE = join(REPO_ROOT, "tools/oracle/cases/f205-canvas");
const BAD_DECLARATION = join(
  REPO_ROOT,
  "tools/corpus/fixtures/bad-declaration.nf",
);

/** The node ids of the fixture's entry workflow (projection keys, ADR 0036). */
export const NODE = {
  params: "main.nf#/:params",
  greeted: "main.nf#/greeted",
  counted: "main.nf#/counted",
  wc: "main.nf#/wc",
  shouted: "main.nf#/shouted",
  tail: "main.nf#/tail",
  output: "main.nf#/:output",
  names: "main.nf#/ch_names",
  total: "main.nf#/total",
  code: "main.nf#/:code@1",
} as const;

/** Opens a project in the UI with the version the header selects. */
export async function openProject(
  page: Page,
  files: { path: string; text: string }[],
): Promise<void> {
  const version = await page.getByLabel("Nextflow version").inputValue();
  await page.evaluate(
    async ({ files, version }) => {
      const hook = (window as unknown as { nfBuilderWorkspace: WorkspaceHook })
        .nfBuilderWorkspace;
      await hook.open({ version, files });
    },
    { files, version },
  );
}

export const openFixture = (page: Page) =>
  openProject(page, readProject(F205_FIXTURE));

/** Opens `bad-declaration.nf` as `main.nf`: its entry workflow calls the unparsed `SECOND`. */
export const openBadDeclaration = (page: Page) =>
  openProject(page, [
    { path: "main.nf", text: readFileSync(BAD_DECLARATION, "utf8") },
  ]);

export async function openWorkflow(
  page: Page,
  path: string,
  workflow: string | null,
): Promise<void> {
  await page.evaluate(
    async ({ path, workflow }) => {
      const hook = (window as unknown as { nfBuilderWorkspace: WorkspaceHook })
        .nfBuilderWorkspace;
      await hook.openWorkflow(path, workflow);
    },
    { path, workflow },
  );
}

/** Waits until the nodes are measured and the first fit has run. */
export async function canvasReady(page: Page): Promise<void> {
  await page
    .locator('.workflow-canvas[data-canvas-state="ready"]')
    .waitFor({ state: "visible" });
}

export const node = (page: Page, id: string): Locator =>
  page.locator(`.react-flow__node[data-id="${id}"]`);

/** The viewport's zoom, read from its transform. */
export function viewportZoom(page: Page): Promise<number> {
  return page.locator(".react-flow__viewport").evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return m.a;
  });
}

const BASELINE_GUIDANCE =
  "No approved baseline, or the canvas changed: download the playwright-chromium artifact, view the -actual.png and commit it as the baseline (ADR 0021)";

/**
 * Compares `target` (or a clip of the page) with its approved baseline. With updateSnapshots "none" Playwright writes
 * no -actual.png for a missing baseline, so write and attach it here before failing.
 */
export async function expectBaseline(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: { target?: Locator; clip?: Clip } = {},
): Promise<void> {
  const shot = {
    animations: "disabled",
    caret: "hide",
  } as const;
  if (!existsSync(testInfo.snapshotPath(name))) {
    const actual = testInfo.outputPath(name.replace(/\.png$/, "-actual.png"));
    if (options.target !== undefined)
      await options.target.screenshot({ path: actual, ...shot });
    else await page.screenshot({ path: actual, clip: options.clip, ...shot });
    await testInfo.attach(name.replace(/\.png$/, "-actual.png"), {
      path: actual,
      contentType: "image/png",
    });
    throw new Error(
      `${BASELINE_GUIDANCE}. Expected at ${testInfo.snapshotPath(name)}`,
    );
  }
  if (options.target !== undefined)
    await expect(options.target, BASELINE_GUIDANCE).toHaveScreenshot(name);
  else
    await expect(page, BASELINE_GUIDANCE).toHaveScreenshot(name, {
      clip: options.clip,
    });
}

type Clip = { x: number; y: number; width: number; height: number };

/**
 * Waits until every node on the canvas has the same box over several consecutive animation frames: a toggle changes node
 * heights and the layout re-places the nodes, so a clip measured too early is off.
 */
export async function layoutSettled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const boxes = () =>
          [...document.querySelectorAll(".react-flow__node")]
            .map((el) => {
              const r = el.getBoundingClientRect();
              return `${r.x},${r.y},${r.width},${r.height}`;
            })
            .join(";");
        let last = boxes();
        let stable = 0;
        const tick = () => {
          const now = boxes();
          stable = now === last ? stable + 1 : 0;
          last = now;
          if (stable >= 10) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** The page rectangle of a node with `pad` pixels around it, once the layout has settled. */
export async function nodeClip(locator: Locator, pad = 16): Promise<Clip> {
  await layoutSettled(locator.page());
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the node has no box");
  return {
    x: Math.max(0, Math.floor(box.x - pad)),
    y: Math.max(0, Math.floor(box.y - pad)),
    width: Math.ceil(box.width + 2 * pad),
    height: Math.ceil(box.height + 2 * pad),
  };
}
