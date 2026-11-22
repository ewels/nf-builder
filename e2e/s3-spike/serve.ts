// Builds the spike page and serves it on two ports with two header sets (ADR 0022).
import { build, type InlineConfig, preview } from "vite";
import { spikeHeaders } from "./headers.ts";
import {
  DIST_DIR,
  PUBLIC_DIR,
  SPIKE_PORT,
  SPIKE_QA30_PORT,
  WWW_DIR,
} from "./paths.ts";
import { main as prepare } from "./prepare.ts";

export function viteConfig(): InlineConfig {
  return {
    configFile: false,
    root: WWW_DIR,
    publicDir: PUBLIC_DIR,
    // "mpa": missing files 404. The SPA fallback would answer 200 with HTML for paths CheerpJ probes under /app/.
    appType: "mpa",
    logLevel: "warn",
    build: { outDir: DIST_DIR, emptyOutDir: true },
    worker: { format: "iife" },
  };
}

export async function main(): Promise<void> {
  const prepared = prepare(process.env);
  if (prepared !== 0) process.exit(prepared);
  await build(viteConfig());
  // The QA-30 probe first, so the main port is up last (Playwright waits for it).
  for (const [kind, port] of [
    ["qa30", SPIKE_QA30_PORT],
    ["cheerpj", SPIKE_PORT],
  ] as const) {
    const server = await preview({
      ...viteConfig(),
      preview: {
        port,
        strictPort: true,
        host: "localhost",
        headers: spikeHeaders(kind),
      },
    });
    server.printUrls();
  }
}

await main();
