import { defineConfig, devices } from "@playwright/test";
import { REPO_ROOT, SPIKE_URL } from "./s3-spike/paths.ts";

// Local-only spike S3 (F-007, ADR 0022): `pnpm test:e2e -- --config e2e/s3-spike.config.ts`.
// The root config never collects *.spike.ts. Chromium only. In the agent sandbox, export PW_CHROMIUM_EXECUTABLE;
// Chromium reaches the CheerpJ CDN through HTTPS_PROXY (launch option below), CI and laptops connect directly.
export function sandboxProxy(
  env: NodeJS.ProcessEnv,
): { server: string; bypass: string } | undefined {
  return env.HTTPS_PROXY
    ? { server: env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined;
}

export default defineConfig({
  testDir: "s3-spike",
  testMatch: "**/*.spike.ts",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 10 * 60_000,
  outputDir: "../test-results/s3-spike",
  reporter: "list",
  use: { baseURL: SPIKE_URL, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
          proxy: sandboxProxy(process.env),
        },
      },
    },
  ],
  webServer: {
    command: "node e2e/s3-spike/serve.ts",
    cwd: REPO_ROOT,
    url: `${SPIKE_URL}/`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
