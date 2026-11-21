import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import {
  readNetlifyConfig,
  siteHeaders,
} from "../../scripts/netlify-config.ts";
import { versionJson } from "../../scripts/version-json.ts";

// netlify.toml is the single source of response headers; `vite preview` sends all of them so e2e runs under the production CSP.
const headers = siteHeaders(readNetlifyConfig());
// `vite dev` injects an inline React Refresh script and <style> tags, which that CSP blocks, so dev gets every header except the CSP.
const devHeaders = Object.fromEntries(
  Object.entries(headers).filter(
    ([name]) => name.toLowerCase() !== "content-security-policy",
  ),
);

export default defineConfig({
  plugins: [react(), versionJson(process.env)],
  server: { port: 5173, strictPort: true, headers: devHeaders },
  preview: { port: 4173, strictPort: true, headers },
});
