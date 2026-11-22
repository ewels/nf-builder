import { defineConfig, devices } from "@playwright/test";
import {
  type BrowserName,
  SMOKE_TAG,
  selectedBrowsers,
  VISUAL_TAG,
  visualEnabled,
} from "./e2e/browsers.ts";
import { DEV_URL, PREVIEW_URL } from "./e2e/urls.ts";

// This sandbox ships an older Chromium than @playwright/test expects: point PW_CHROMIUM_EXECUTABLE at it.
// Local runs use Chromium only. CI runs one job per browser with PW_BROWSERS (F-003, QA-20).
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined;

const viewport = { width: 1440, height: 900 };

// QA-20: Chromium runs every end-to-end test; Firefox and WebKit run the @smoke tests.
const grep = new RegExp(`${SMOKE_TAG}\\b`);

function project(name: BrowserName) {
  switch (name) {
    case "chromium":
      return {
        use: {
          ...devices["Desktop Chrome"],
          viewport,
          launchOptions: { executablePath },
        },
        grepInvert: visualEnabled(process.env)
          ? undefined
          : new RegExp(`${VISUAL_TAG}\\b`),
      };
    case "firefox":
      return { grep, use: { ...devices["Desktop Firefox"], viewport } };
    case "webkit":
      return { grep, use: { ...devices["Desktop Safari"], viewport } };
  }
}

export default defineConfig({
  testDir: "e2e",
  // Baselines are never written implicitly: a missing or changed one fails and the actual image lands in test-results/.
  updateSnapshots: "none",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
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
