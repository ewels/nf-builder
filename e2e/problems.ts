// Helpers for the problems panel end-to-end tests (F-309). The engine hook is `window.nfBuilderEngine`.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { openProject } from "./canvas.ts";
import { type EngineHook, readProject } from "./engine.ts";

/** One fixable `deprecated-channel` warning and two suggestions (the `legacy-workflow` and `legacy-process` codes). */
export const F309_FIXTURE = join(REPO_ROOT, "tools/oracle/cases/f309-problems");
/** The same tree with `channel.of`: what the quick fix must produce. */
export const F309_FIXED = join(
  REPO_ROOT,
  "tools/oracle/cases/f309-problems-fixed",
);

export const openProblemsFixture = (page: Page) =>
  openProject(page, readProject(F309_FIXTURE));

/** Waits until the status bar holds the project's diagnostics for its current revision. */
export const problemsReady = (page: Page): Locator =>
  page.locator('.status-bar[data-diagnostics="ready"]');

/** The status-bar count button: the problems one or the suggestions one. */
export const statusCount = (
  page: Page,
  kind: "problems" | "suggestions",
): Locator => page.locator(`.status-bar #status-${kind}`);

/** The engine's own diagnostics, through the test hook. */
export function engineDiagnostics(page: Page) {
  return page.evaluate(async () => {
    const result = await (
      window as unknown as { nfBuilderEngine: EngineHook }
    ).nfBuilderEngine.diagnostics();
    return result.diagnostics ?? [];
  });
}
