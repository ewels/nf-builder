// Helpers for the canvas end-to-end tests (F-205). The workspace hook is `window.nfBuilderWorkspace`.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { readProject } from "./engine.ts";

interface WorkspaceHook {
  open(request: {
    version: string;
    files: { path: string; text: string }[];
  }): Promise<unknown>;
  openWorkflow(path: string, workflow: string | null): Promise<void>;
}

export const F205_FIXTURE = join(REPO_ROOT, "tools/oracle/cases/f205-canvas");
export const BAD_DECLARATION = join(
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
  upper: "main.nf#/upper",
  output: "main.nf#/:output",
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

export const openFixture = (page: Page, dir = F205_FIXTURE) =>
  openProject(page, readProject(dir));

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

export const edge = (page: Page, id: string): Locator =>
  page.locator(`.react-flow__edge[data-id="${id}"]`);

/** The viewport's zoom, read from its transform. */
export function viewportZoom(page: Page): Promise<number> {
  return page.locator(".react-flow__viewport").evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return m.a;
  });
}
