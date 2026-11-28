// Helpers for the edit popup end-to-end tests (F-303, F-304): the dialog, opening it, filling its Configure form, and
// the Code tab's editor.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
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

/** The fixture the Code tab's edit ends in (F-304): GREET with a new description, `cpus 2` and a comment. */
export const CODE_EDITED = join(
  REPO_ROOT,
  "tools/oracle/cases/f304-code-edited",
);
/** A typed process laid out irregularly, called as `counted` in the entry workflow. */
export const FORMAT_START = join(
  REPO_ROOT,
  "tools/oracle/cases/f304-format-start",
);
export const COUNTED_NODE = "main.nf#/counted";

/** The declaration in a module file's text: from its doc comment to its closing brace. */
export const declarationOf = (text: string): string =>
  text.slice(text.indexOf("/**"), text.lastIndexOf("}") + 1);

/** The process `COUNT` of the formatter's golden for the format fixture (the printed form `nextflow lint -format` gives). */
export const formattedSlice = (): string =>
  declarationOf(
    readFileSync(
      join(
        REPO_ROOT,
        "packages/lang-2610/test/printer/formatted/f304-format.nf",
      ),
      "utf8",
    ),
  );

/** Switches to the Code tab and waits for the editor. */
export async function openCodeTab(page: Page): Promise<void> {
  const dialog = popup(page);
  await dialog.getByRole("tab", { name: "Code" }).click();
  await expect(dialog.locator(".monaco-editor")).toBeVisible();
}

/** The editor's text, from its rendered lines in order (Monaco draws spaces as no-break spaces). */
export async function codeText(page: Page): Promise<string> {
  return popup(page)
    .locator(".monaco-editor .view-lines .view-line")
    .evaluateAll((els) =>
      (els as HTMLElement[])
        .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
        .map((el) => (el.textContent ?? "").replace(/\u00a0/g, " "))
        .join("\n"),
    );
}

/** Replaces the whole text of the editor with `text`, pasted so Monaco doesn't auto-indent or close brackets. */
export async function typeInPopupEditor(
  page: Page,
  text: string,
): Promise<void> {
  await popup(page).locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.evaluate((pasted) => {
    const data = new DataTransfer();
    data.setData("text/plain", pasted);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}
