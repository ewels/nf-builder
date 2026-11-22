import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { WEB_DIST } from "../scripts/check-common.ts";
import { readWorkerManifest } from "../scripts/worker-manifest.ts";

/** Every file under `dir` as project files, with POSIX paths relative to it. */
export function readProject(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        out.push({
          path: relative(dir, full).split("\\").join("/"),
          text: readFileSync(full, "utf8"),
        });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The built worker chunks that hold the parser (its source is the pack's source/index.ts). */
export function parserChunks(): string[] {
  return readWorkerManifest(WEB_DIST)
    .filter((c) => c.src?.endsWith("packages/lang-2610/src/source/index.ts"))
    .map((c) => c.file);
}

/** The subset of the engine API the tests and the bench call, on `window.nfBuilderEngine`. */
export interface EngineHook {
  open(
    request: { version: string; files: { path: string; text: string }[] },
    onProgress?: (progress: {
      phase: string;
      done: number;
      total: number;
    }) => void,
  ): Promise<{ revision: number }>;
  writeFiles(
    files: { path: string; text: string | null }[],
  ): Promise<{ revision?: number }>;
  apply(
    command: unknown,
    revision: number,
  ): Promise<{
    ok: boolean;
    revision: number | null;
    remodelled?: string[];
    inverse?: unknown;
    code?: string;
    message?: string;
  }>;
  applyPatches(
    patches: unknown,
    revision: number,
  ): Promise<{ ok: boolean; revision: number | null }>;
  project(path: string, workflow: string | null): Promise<unknown>;
}
