import { defineConfig, devices } from "@playwright/test";
import { PREVIEW_URL } from "./urls.ts";

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
  // F-011: the app is served under /nf-builder/, so the base URL (and the web server URL below) need that path
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
    // Always a fresh production build, served with the netlify.toml headers.
    command: "pnpm build && pnpm preview",
    url: PREVIEW_URL,
    timeout: 120_000,
  },
});
