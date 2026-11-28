// Helpers for the workflow tab end-to-end tests (F-307): the fixture, the breadcrumb and a node's input ports.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { openStoredFixture } from "./history.ts";

/** A typed entry workflow that calls ALIGN twice (once as MAP); ALIGN calls SORT. */
const TABS_FIXTURE = join(REPO_ROOT, "tools/oracle/cases/f307-workflow-tabs");
export const ALIGN_PATH = "subworkflows/local/align/main.nf";
export const ALIGNED = "main.nf#/aligned";
export const MAPPED = "main.nf#/mapped";

export const openAlignFixture = (page: Page, name: string) =>
  openStoredFixture(page, name, TABS_FIXTURE);

export const breadcrumb = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Workflow path" });

/** The workflow tabs named `label`. */
export const tabNamed = (page: Page, label: string): Locator =>
  page.getByRole("tab", { name: label, exact: true });

/** The input ports (handle ids without the `in:` prefix) a node draws, in document order. */
export function inputPorts(page: Page, nodeId: string): Promise<string[]> {
  return page
    .locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle`)
    .evaluateAll((handles) =>
      handles
        .map((h) => h.getAttribute("data-handleid") ?? "")
        .filter((id) => id.startsWith("in:"))
        .map((id) => id.slice(3)),
    );
}
