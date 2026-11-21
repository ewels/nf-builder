import { defineConfig, devices } from "@playwright/test";
import { DEV_URL, PREVIEW_URL } from "./e2e/urls.ts";

// This sandbox ships an older Chromium than @playwright/test expects: point PW_CHROMIUM_EXECUTABLE at it.
// CI installs matching browsers and adds Firefox and WebKit (F-003).
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: { baseURL: PREVIEW_URL, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath },
      },
    },
  ],
  webServer: [
    // Always a fresh production build, served with the netlify.toml headers.
    {
      command: "pnpm build && pnpm preview",
      url: PREVIEW_URL,
      reuseExistingServer: false,
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
