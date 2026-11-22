// Helpers for the Code view end-to-end tests (F-208).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  initialJsFiles,
  type Manifest,
} from "../scripts/check-bundle-budget.ts";
import { WEB_DIST } from "../scripts/check-common.ts";
import { E2E_BASE_PATH } from "./urls.ts";

/** A message only Monaco's core contains (the worker-loading error). */
export const MONACO_MARKER =
  "MonacoEnvironment.getWorkerUrl or MonacoEnvironment.getWorker";

/** The built JavaScript files outside the initial load, as `assets/...` paths. */
export function lazyJsFiles(): { initial: string[]; lazy: string[] } {
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = initialJsFiles(manifest, html, E2E_BASE_PATH);
  const lazy = readdirSync(join(WEB_DIST, "assets"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `assets/${f}`)
    .filter((f) => !initial.includes(f));
  return { initial, lazy };
}

/** The lazy files that hold Monaco's core. */
export const monacoChunks = (): string[] =>
  lazyJsFiles().lazy.filter((f) =>
    readFileSync(join(WEB_DIST, f), "utf8").includes(MONACO_MARKER),
  );
