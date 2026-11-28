// Helpers for the config editor end-to-end tests (F-601). The workspace hook is `window.nfBuilderWorkspace`.
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { canvasReady, openProject } from "./canvas.ts";
import { readProject } from "./engine.ts";

const CASES = join(REPO_ROOT, "tools/oracle/cases");
export const F601_CONFIG = join(CASES, "f601-config");
export const F601_CONFIG_AFTER = join(CASES, "f601-config-after");
export const F601_UNKNOWN = join(CASES, "f601-unknown");
export const F601_UNKNOWN_AFTER = join(CASES, "f601-unknown-after");
export const F601_SELECTORS = join(CASES, "f601-selectors");
export const F601_FORMS_AFTER = join(CASES, "f601-forms-after");

/** Opens a fixture directory as the project, waits for its canvas, then opens `path` from the entry summary's link. */
export async function openConfigTab(
  page: Page,
  dir: string,
  path = "nextflow.config",
): Promise<void> {
  await openProject(page, readProject(dir));
  await canvasReady(page);
  await page.getByRole("button", { name: `Open ${path}` }).click();
  await configReady(page);
}

/** The form is drawn: the config pane has pulled its view. */
export const configReady = (page: Page): Promise<void> =>
  expect(page.locator('[data-config-state="ready"]')).toBeVisible();

/** The top-level card of `scope`. */
export const configCard = (page: Page, scope: string): Locator =>
  page
    .locator(".config-card.is-card")
    .filter({
      has: page.locator(".config-card-toggle", {
        hasText: new RegExp(`^${scope}$`),
      }),
    })
    .first();

/** The value field of an option row directly in `card`, not in a selector or profile nested in it. */
export const optionField = (card: Locator, label: string): Locator =>
  card.locator(
    `:scope > .config-card-body > .config-rows [data-option="${label}"] input`,
  );

/** The selector card written `written` (`withLabel: big_mem`). */
export const selectorCard = (page: Page, written: string): Locator =>
  page.locator(".config-card.is-selector").filter({
    has: page.locator(".config-card-toggle", { hasText: written }),
  });

/** The details pane's config content. */
export const configDetails = (page: Page): Locator =>
  page.locator(".config-details");
