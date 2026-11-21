export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type BrowserName = (typeof BROWSERS)[number];
export const SMOKE_TAG = "@smoke";
/** QA-20: Chromium runs every end-to-end test; Firefox and WebKit run the @smoke tests. */
export const SMOKE_ONLY: readonly BrowserName[] = ["firefox", "webkit"];

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
