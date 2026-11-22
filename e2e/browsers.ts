const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type BrowserName = (typeof BROWSERS)[number];
export const SMOKE_TAG = "@smoke";
export const VISUAL_TAG = "@visual";

/** Visual baselines are rendered and compared only in CI (Linux, Playwright's Chromium) unless PW_VISUAL=1. */
export function visualEnabled(
  env: Record<string, string | undefined>,
): boolean {
  return Boolean(env.CI) || env.PW_VISUAL === "1";
}

export function selectedBrowsers(value: string | undefined): BrowserName[] {
  if (!value?.trim()) return ["chromium"];
  const names: BrowserName[] = [];
  for (const raw of value.split(",")) {
    const name = raw.trim();
    const known = BROWSERS.find((b) => b === name);
    if (!known) {
      throw new Error(
        `PW_BROWSERS: unknown browser "${name}"; use chromium, firefox or webkit, comma-separated`,
      );
    }
    if (!names.includes(known)) names.push(known);
  }
  return names;
}
