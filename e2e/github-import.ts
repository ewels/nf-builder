// The GitHub source of the Import route, for the F-401 end-to-end tests.
import type { Locator, Page } from "@playwright/test";
import { openNewProjectDialog } from "./templates.ts";

/** The New project dialog on the GitHub source with the form filled in and Review pressed; waits for the summary or an alert. */
export async function reviewGithub(
  page: Page,
  repo: string,
  ref: string,
): Promise<Locator> {
  const dialog = await openNewProjectDialog(page);
  await dialog.getByRole("radio", { name: "Import", exact: true }).check();
  await dialog.getByRole("radio", { name: "GitHub repository" }).check();
  await dialog.getByLabel("Repository", { exact: true }).fill(repo);
  await dialog.getByLabel("Branch, tag or commit").fill(ref);
  await dialog.getByRole("button", { name: "Review" }).click();
  await dialog
    .getByRole("heading", { name: "Import summary" })
    .or(dialog.getByRole("alert"))
    .waitFor({ timeout: 30_000 });
  return dialog;
}

/** Presses the Import button of a reviewed repository. */
export const startImport = (dialog: Locator): Promise<void> =>
  dialog.getByRole("button", { name: /^Import \d+ files?$/ }).click();

/** Reviews and imports; returns the dialog (hidden once the import has finished). */
export async function importFromGithub(
  page: Page,
  repo: string,
  ref: string,
): Promise<Locator> {
  const dialog = await reviewGithub(page, repo, ref);
  await startImport(dialog);
  return dialog;
}

export const reportDialog = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Import report" });
