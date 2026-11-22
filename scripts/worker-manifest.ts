// Vite leaves worker chunks out of .vite/manifest.json (F-113). This plugin pair records them: `collect` runs in the
// worker build (`worker.plugins`) and notes each chunk; `emit` runs in the main build and writes
// .vite/worker-manifest.json, so scripts/check-hosts.ts can skip JSON-sourced chunks (IO-41, ADR 0028) and e2e tests
// can find the parser chunks. A build artefact like Vite's manifest, not a stored format.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Plugin } from "vite";

export interface WorkerChunk {
  file: string;
  /** Source path relative to the root, as in Vite's manifest; null for a chunk with no single source module. */
  src: string | null;
  isEntry: boolean;
  dynamicImports: readonly string[];
}

export const WORKER_MANIFEST_FILE = ".vite/worker-manifest.json";

interface ChunkLike {
  type: string;
  fileName: string;
  facadeModuleId?: string | null;
  isEntry?: boolean;
  dynamicImports?: readonly string[];
}

export function workerManifest(root: string): {
  collect(): Plugin;
  emit: Plugin;
} {
  const chunks = new Map<string, WorkerChunk>();
  return {
    collect: () => ({
      name: "nf-builder:worker-manifest-collect",
      generateBundle(_options, bundle) {
        for (const item of Object.values(bundle) as ChunkLike[]) {
          if (item.type !== "chunk") continue;
          const id = item.facadeModuleId?.replace(/\?.*$/, "");
          chunks.set(item.fileName, {
            file: item.fileName,
            src: id ? relative(root, id).split("\\").join("/") : null,
            isEntry: item.isEntry === true,
            dynamicImports: [...(item.dynamicImports ?? [])],
          });
        }
      },
    }),
    emit: {
      name: "nf-builder:worker-manifest-emit",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: WORKER_MANIFEST_FILE,
          source: JSON.stringify([...chunks.values()], null, 2),
        });
      },
    },
  };
}

/** The worker chunks recorded in `distDir`; [] when there is no worker manifest. */
export function readWorkerManifest(distDir: string): WorkerChunk[] {
  const path = join(distDir, WORKER_MANIFEST_FILE);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as WorkerChunk[];
}
