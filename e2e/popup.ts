// Helpers for the edit popup end-to-end tests (F-303): the dialog, opening it, and filling its Configure form.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { node } from "./canvas.ts";

/** The fixture the Configure tests start from: a typed entry workflow that calls a described local process. */
export const CONFIGURE_START = join(
  REPO_ROOT,
  "tools/oracle/cases/f303-configure-start",
);
export const CONFIGURE_TYPED = join(
  REPO_ROOT,
  "tools/oracle/cases/f303-configure-typed",
);
/** The call's node in both fixtures (`greet = GREET('world')`, ADR 0036). */
export const GREET_NODE = "main.nf#/greet";

export const popup = (page: Page): Locator =>
  page.getByRole("dialog", { name: /^Edit process / });

/** Double-clicks a node's title bar. */
export async function openPopupByDoubleClick(
  page: Page,
  id: string,
): Promise<void> {
  await node(page, id).locator(".canvas-node-title").first().dblclick();
}

/** Adds an input row at the end of the Inputs section and fills it. */
export async function addInput(
  page: Page,
  input: { name: string; type: string; nullable: boolean },
): Promise<void> {
  const dialog = popup(page);
  await dialog.getByRole("button", { name: "Add input", exact: true }).click();
  const rows = dialog.locator('[data-field^="inputs."][data-field$=".name"]');
  const last = (await rows.count()) - 1;
  await dialog.locator(`[data-field="inputs.${last}.name"]`).fill(input.name);
  await dialog.locator(`[data-field="inputs.${last}.type"]`).fill(input.type);
  if (input.nullable)
    await dialog
      .locator(`[data-field="inputs.${last}.type"]`)
      .locator("xpath=ancestor::li[1]")
      .getByLabel("Nullable")
      .check();
}

/** Searches the directive list for `query` and picks the option named `name`. */
export async function addDirective(
  page: Page,
  query: string,
  name: string,
): Promise<void> {
  const dialog = popup(page);
  await dialog.getByRole("combobox", { name: "Add a directive" }).fill(query);
  await dialog
    .getByRole("option")
    .filter({
      has: page.locator(".directive-name", {
        hasText: new RegExp(`^${name}$`),
      }),
    })
    .click();
}

/** The names of the options the directive list shows now. */
export const directiveNames = (page: Page): Promise<string[]> =>
  popup(page).locator('[role="option"] .directive-name').allTextContents();
