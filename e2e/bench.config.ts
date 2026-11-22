import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_PATH, PREVIEW_URL } from "./urls.ts";

// F-113 (QA-03, QA-04): `pnpm bench`. Chromium only, one worker, run after `pnpm corpus:fetch`. The root config never
// collects *.bench.ts.
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "bench",
  testMatch: "**/*.bench.ts",
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  timeout: 10 * 60_000,
  outputDir: "../test-results/bench",
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  // The app is served under E2E_BASE_PATH, as on GitHub Pages (ADR 0040).
  use: { baseURL: PREVIEW_URL },
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
  webServer: {
    // Always a fresh production build, served as GitHub Pages serves it (ADR 0040).
    command: "pnpm build && pnpm preview",
    url: PREVIEW_URL,
    env: { BASE_PATH: E2E_BASE_PATH },
    timeout: 120_000,
  },
});
