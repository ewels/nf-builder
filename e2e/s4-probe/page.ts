import type { Page } from "@playwright/test";
import type { BrowserResult, TargetInput } from "./report.ts";

declare global {
  interface Window {
    s4Probe?: {
      run(targets: readonly TargetInput[]): Promise<BrowserResult[]>;
    };
  }
}

/** Relative to the site base URL, so it works under /nf-builder/ (ADR 0040). */
export const PROBE_PATH = "spike/s4/";
export const PROBE_TITLE = "nf-builder: S4 CORS probe";

/** Goes to spike/s4/ (relative to baseURL) and waits for window.s4Probe. */
export async function openProbe(page: Page): Promise<void> {
  await page.goto(PROBE_PATH);
  await page.waitForFunction(() => window.s4Probe !== undefined);
}

/** Calls window.s4Probe.run in the page. */
export async function runInPage(
  page: Page,
  targets: readonly TargetInput[],
): Promise<BrowserResult[]> {
  return page.evaluate((list) => {
    const probe = window.s4Probe;
    if (!probe) throw new Error("window.s4Probe is missing");
    return probe.run(list);
  }, targets);
}
