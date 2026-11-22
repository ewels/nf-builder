/// <reference lib="dom" />
import type { Page, Response } from "@playwright/test";
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

/** Goes to spike/s4/ (relative to baseURL), waits for window.s4Probe; returns the navigation response. */
export async function openProbe(page: Page): Promise<Response | null> {
  const response = await page.goto(PROBE_PATH);
  await page.waitForFunction(() => window.s4Probe !== undefined);
  return response;
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

/** Removes the CSP <meta> and nothing else, so the deployed probe measures CORS, not our own policy (ADR 0023, 0040). */
export function stripPolicyMeta(html: string): string {
  return html.replace(
    /<meta\s[^>]*\bhttp-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
    "",
  );
}
