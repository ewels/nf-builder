import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readWorkerManifest,
  workerManifest,
} from "../scripts/worker-manifest.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// The plugin hooks are called the way Rollup calls them, with a fake bundle.
type Hook = (this: unknown, ...args: unknown[]) => unknown;
const hook = (plugin: unknown): Hook =>
  ((plugin as { generateBundle: Hook }).generateBundle as Hook).bind({});

describe("worker manifest", () => {
  it("F-113 IO-41: the worker manifest records each worker chunk with its root-relative source", () => {
    const root = "/repo/apps/web";
    const { collect, emit } = workerManifest(root);
    hook(collect())(
      {},
      {
        "assets/engine.worker-1.js": {
          type: "chunk",
          fileName: "assets/engine.worker-1.js",
          facadeModuleId: `${root}/src/engine/engine.worker.ts?worker_file&type=module`,
          isEntry: true,
          dynamicImports: ["assets/script-2.js"],
        },
        "assets/script-2.js": {
          type: "chunk",
          fileName: "assets/script-2.js",
          facadeModuleId: "/repo/packages/lang-2610/catalogue/script.json",
          isEntry: false,
          dynamicImports: [],
        },
        "assets/shared-3.js": {
          type: "chunk",
          fileName: "assets/shared-3.js",
          facadeModuleId: null,
          isEntry: false,
          dynamicImports: [],
        },
        "assets/x.map": { type: "asset", fileName: "assets/x.map" },
      },
    );
    const emitted: { fileName: string; source: string }[] = [];
    (emit as unknown as { generateBundle: Hook }).generateBundle.call(
      {
        emitFile: (f: { fileName: string; source: string }) => emitted.push(f),
      },
      {},
      {},
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.fileName).toBe(".vite/worker-manifest.json");
    expect(JSON.parse(emitted[0]?.source ?? "")).toEqual([
      {
        file: "assets/engine.worker-1.js",
        src: "src/engine/engine.worker.ts",
        isEntry: true,
        dynamicImports: ["assets/script-2.js"],
      },
      {
        file: "assets/script-2.js",
        src: "../../packages/lang-2610/catalogue/script.json",
        isEntry: false,
        dynamicImports: [],
      },
      {
        file: "assets/shared-3.js",
        src: null,
        isEntry: false,
        dynamicImports: [],
      },
    ]);
  });

  it("F-113 IO-41: readWorkerManifest gives [] when the file is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-builder-wm-"));
    dirs.push(dir);
    expect(readWorkerManifest(dir)).toEqual([]);
    mkdirSync(join(dir, ".vite"));
    writeFileSync(
      join(dir, ".vite/worker-manifest.json"),
      JSON.stringify([
        { file: "a.js", src: null, isEntry: true, dynamicImports: [] },
      ]),
    );
    expect(readWorkerManifest(dir)).toHaveLength(1);
  });
});
