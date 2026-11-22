import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import {
  readNetlifyConfig,
  siteHeaders,
} from "../../scripts/netlify-config.ts";
import { registrySnapshot } from "../../scripts/registry-snapshot-site.ts";
import { versionJson } from "../../scripts/version-json.ts";
import { workerManifest } from "../../scripts/worker-manifest.ts";

// netlify.toml is the single source of response headers; `vite preview` sends all of them so e2e runs under the production CSP.
const headers = siteHeaders(readNetlifyConfig());
// `vite dev` injects an inline React Refresh script and <style> tags, which that CSP blocks, so dev gets every header except the CSP.
const { "Content-Security-Policy": _csp, ...devHeaders } = headers;

// F-113: Vite leaves worker chunks out of its manifest; these two plugins record them in .vite/worker-manifest.json.
const workerChunks = workerManifest(import.meta.dirname);

export default defineConfig({
  plugins: [
    react(),
    versionJson(process.env),
    registrySnapshot(process.env),
    workerChunks.emit,
  ],
  // ES workers are needed for the worker's dynamic imports (the parser and catalogue chunks).
  worker: { format: "es", plugins: () => [workerChunks.collect()] },
  server: { port: 5173, strictPort: true, headers: devHeaders },
  preview: { port: 4173, strictPort: true, headers },
  // QA-01: scripts/check-bundle-budget.ts reads dist/.vite/manifest.json to find the initial JavaScript.
  build: { manifest: true },
});
