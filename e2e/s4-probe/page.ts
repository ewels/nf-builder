import type { Page, Response } from "@playwright/test";
import type { BrowserResult, TargetInput } from "./report.ts";

declare global {
  interface Window {
    s4Probe?: {
      run(targets: readonly TargetInput[]): Promise<BrowserResult[]>;
    };
  }
}

export const PROBE_PATH = "/spike/s4/";
export const PROBE_TITLE = "nf-builder: S4 CORS probe";

/** Goes to <base>/spike/s4/, waits for window.s4Probe; returns the navigation response. */
export async function openProbe(
  page: Page,
  base = "",
): Promise<Response | null> {
  const response = await page.goto(`${base}${PROBE_PATH}`);
  await page.waitForFunction(() => window.s4Probe !== undefined);
  return response;
}

/** Calls window.s4Probe.run with { id, url } pairs only. */
export async function runInPage(
  page: Page,
  targets: readonly TargetInput[],
): Promise<BrowserResult[]> {
  const pairs = targets.map(({ id, url }) => ({ id, url }));
  return page.evaluate((list) => {
    const probe = window.s4Probe;
    if (!probe) throw new Error("window.s4Probe is missing");
    return probe.run(list);
  }, pairs);
}
