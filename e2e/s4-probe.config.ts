import { defineConfig, devices } from "@playwright/test";
import { type BrowserName, selectedBrowsers } from "./browsers.ts";
import { probeOrigin } from "./s4-probe/report.ts";

// Deployed-only probe (F-008, ADR 0023): `S4_PROBE_URL=<site> pnpm test:e2e -- --config e2e/s4-probe.config.ts`.
// The root config never collects *.probe.ts. Fail fast on a missing or bad URL.
probeOrigin(process.env.S4_PROBE_URL);

const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined;
const viewport = { width: 1440, height: 900 };
// The OpenAPI check doesn't depend on the browser: run it once, on Chromium.
const grepInvert = /@openapi\b/;

function project(name: BrowserName) {
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
      return { grepInvert, use: { ...devices["Desktop Firefox"], viewport } };
    case "webkit":
      return { grepInvert, use: { ...devices["Desktop Safari"], viewport } };
  }
}

export default defineConfig({
  testDir: "s4-probe",
  testMatch: "**/*.probe.ts",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 6 * 60_000,
  outputDir: "../test-results/s4-probe",
  reporter: process.env.CI
    ? [
        ["list"],
        ["github"],
        [
          "html",
          { open: "never", outputFolder: "../playwright-report/s4-probe" },
        ],
      ]
    : "list",
  projects: selectedBrowsers(process.env.PW_BROWSERS).map((name) => ({
    name,
    ...project(name),
  })),
});
