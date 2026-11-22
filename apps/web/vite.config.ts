import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { basePath } from "../../scripts/base-path.ts";
import { registrySnapshot } from "../../scripts/registry-snapshot-site.ts";
import { securityPolicyMeta } from "../../scripts/security-policy-meta.ts";
import { versionJson } from "../../scripts/version-json.ts";
import { workerManifest } from "../../scripts/worker-manifest.ts";

// ADR 0040: GitHub Pages sends no headers, so the QA-30 policy is injected into every page at build time.
// `vite dev` and `vite preview` send none: dev has no policy, and preview serves the build as Pages does.
// F-113: Vite leaves worker chunks out of its manifest; these two plugins record them in .vite/worker-manifest.json.
const workerChunks = workerManifest(import.meta.dirname);

export default defineConfig({
  base: basePath(process.env),
  // No single-page-app fallback: the app has no routes and Pages serves a 404 for an unknown path.
  appType: "mpa",
  plugins: [
    react(),
    versionJson(process.env),
    securityPolicyMeta(),
    registrySnapshot(process.env),
    workerChunks.emit,
  ],
  // ES workers are needed for the worker's dynamic imports (the parser and catalogue chunks).
  worker: { format: "es", plugins: () => [workerChunks.collect()] },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  // QA-01: scripts/check-bundle-budget.ts reads dist/.vite/manifest.json to find the initial JavaScript.
  build: { manifest: true },
});
