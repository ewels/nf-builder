// Helpers for the export end-to-end tests (F-404): the header's Export dialog, the downloaded zip read back with fflate.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { unzipSync } from "fflate";
import {
  type CentralEntry,
  centralEntries,
} from "../packages/sources/test/fixtures/zip-attrs.ts";

export interface ExportedZip {
  readonly fileName: string;
  /** Every entry's bytes by its full name in the zip. */
  readonly files: Record<string, Uint8Array>;
  /** The central directory: creator OS and Unix mode per entry. */
  readonly entries: CentralEntry[];
}

/** Opens the Export dialog, leaves the layout box as `layout` says (default: ticked) and downloads the zip. */
export async function exportZip(
  page: Page,
  options: { layout?: boolean } = {},
): Promise<ExportedZip> {
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Export" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export project" });
  await dialog.waitFor();
  const box = dialog.getByRole("checkbox");
  if (options.layout !== undefined && (await box.isEnabled()))
    await box.setChecked(options.layout);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const saved = await download;
  await dialog.waitFor({ state: "hidden" });
  const path = await saved.path();
  const bytes = new Uint8Array(readFileSync(path));
  return {
    fileName: saved.suggestedFilename(),
    files: unzipSync(bytes),
    entries: centralEntries(bytes),
  };
}

/** The files under `<folder>/`, keyed by their path inside the project; throws when an entry sits elsewhere. */
export function stripFolder(
  files: Record<string, Uint8Array>,
  folder: string,
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.startsWith(`${folder}/`))
      throw new Error(`${name} isn't under ${folder}/`);
    out[name.slice(folder.length + 1)] = bytes;
  }
  return out;
}
