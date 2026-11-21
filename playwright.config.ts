import { defineConfig, devices } from "@playwright/test";
import {
  type BrowserName,
  SMOKE_ONLY,
  SMOKE_TAG,
  selectedBrowsers,
} from "./e2e/browsers.ts";
import { DEV_URL, PREVIEW_URL } from "./e2e/urls.ts";

// This sandbox ships an older Chromium than @playwright/test expects: point PW_CHROMIUM_EXECUTABLE at it.
// Local runs use Chromium only. CI runs one job per browser with PW_BROWSERS (F-003, QA-20).
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined;

const viewport = { width: 1440, height: 900 };

function project(name: BrowserName) {
  const grep = SMOKE_ONLY.includes(name)
    ? new RegExp(`${SMOKE_TAG}\\b`)
    : undefined;
  switch (name) {
    case "chromium":
      return {
        use: {
          ...devices["Desktop Chrome"],
          viewport,
          launchOptions: { executablePath },
        },
      };
    case "firefox":
      return { grep, use: { ...devices["Desktop Firefox"], viewport } };
    case "webkit":
      return { grep, use: { ...devices["Desktop Safari"], viewport } };
  }
}

export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : "list",
  use: { baseURL: PREVIEW_URL, trace: "retain-on-failure" },
  projects: selectedBrowsers(process.env.PW_BROWSERS).map((name) => ({
    name,
    ...project(name),
  })),
  webServer: [
    // Always a fresh production build, served with the netlify.toml headers.
    {
      command: "pnpm build && pnpm preview",
      url: PREVIEW_URL,
      timeout: 120_000,
    },
    {
      command: "pnpm dev",
      url: DEV_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
