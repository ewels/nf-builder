// Helpers for the new project dialog end-to-end tests (F-203). The node ids repeat `TEMPLATE_NODES` in
// packages/engine/test/templates/templates.test.ts: dependency rules stop the engine importing e2e/.
import { join } from "node:path";
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { readProject } from "./engine.ts";
import { switcher } from "./projects.ts";

export interface TemplateCase {
  /** The template id, which is its directory in the pack. */
  readonly id: string;
  /** The name in the dialog. */
  readonly name: string;
  /** The entry workflow's nodes, by projection key; `typed` is the call's badge. */
  readonly nodes: readonly {
    id: string;
    kind: string;
    typed: boolean | null;
  }[];
}

export const TEMPLATES: readonly TemplateCase[] = [
  {
    id: "hello-world",
    name: "Hello world",
    nodes: [
      { id: "main.nf#/:params", kind: "params", typed: null },
      { id: "main.nf#/greetings", kind: "factory", typed: null },
      { id: "main.nf#/greeting_file", kind: "call", typed: true },
      { id: "main.nf#/:output", kind: "output", typed: null },
    ],
  },
  {
    id: "samplesheet-multiqc",
    name: "Samplesheet to MultiQC",
    nodes: [
      { id: "main.nf#/:params", kind: "params", typed: null },
      { id: "main.nf#/fastqc", kind: "call", typed: true },
      { id: "main.nf#/reports", kind: "chain", typed: null },
      { id: "main.nf#/multiqc_report", kind: "call", typed: true },
      { id: "main.nf#/channel.topic@1", kind: "factory", typed: null },
      { id: "main.nf#/versions", kind: "chain", typed: null },
      { id: "main.nf#/:output", kind: "output", typed: null },
    ],
  },
];

/** The blank template's entry workflow. */
export const BLANK_NODES = [
  { id: "main.nf#/:params", kind: "params", typed: null },
] as const;

/** The files of a template as the pack keeps them (the tree `templates.json` is generated from). */
export const templateFilesOnDisk = (id: string) =>
  readProject(join(REPO_ROOT, "packages/lang-2610/templates", id));

/** The New project dialog. */
export const newProjectDialog = (root: Page | FrameLocator): Locator =>
  root.getByRole("dialog", { name: "New project" });

/** Opens the dialog from the header panel; Start blank is the route it opens on. */
export async function openNewProjectDialog(
  root: Page | FrameLocator,
): Promise<Locator> {
  await switcher(root).click();
  await root.getByRole("button", { name: "New project…" }).click();
  const dialog = newProjectDialog(root);
  await dialog.waitFor();
  return dialog;
}

/** Creates a project from a template through the dialog and waits for it to open. */
export async function createFromTemplate(
  page: Page,
  template: string,
  name: string,
): Promise<void> {
  const dialog = await openNewProjectDialog(page);
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("radio", { name: "From a template" }).check();
  await dialog.getByRole("radio", { name: template, exact: true }).check();
  await dialog.getByRole("button", { name: "Create" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("banner")
    .getByRole("button", { name, exact: true })
    .waitFor();
}

/** The ids of the canvas's nodes, in the order of the DOM. */
export const canvasNodeIds = (page: Page): Promise<string[]> =>
  page
    .locator(".react-flow__node")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-id") ?? "").sort(),
    );
