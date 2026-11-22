import { join } from "node:path";
import { defineConfig } from "vite";
import { spikeS5Headers } from "./headers.ts";
import {
  PUBLIC_DIR,
  SPIKE_S5_CACHE,
  SPIKE_S5_DIR,
  SPIKE_S5_PORT,
} from "./prepare.ts";

export default defineConfig({
  root: SPIKE_S5_DIR,
  publicDir: PUBLIC_DIR,
  appType: "mpa",
  build: { outDir: join(SPIKE_S5_CACHE, "dist"), emptyOutDir: true },
  worker: { format: "es" },
  preview: {
    port: SPIKE_S5_PORT,
    strictPort: true,
    headers: spikeS5Headers(
      process.env.SPIKE_S5_CSP === "production" ? "production" : "spike",
    ),
  },
});
