// Main-thread side of the Comlink bridge (F-113, ADR 0003). The worker starts on the first `getEngine()`, never at import.
import type { EngineApi } from "@nf-builder/engine";
import { type Endpoint, proxy, releaseProxy, wrap } from "comlink";

declare global {
  interface Window {
    /** Test hook (F-113): the engine API, started on first access. */
    nfBuilderEngine?: EngineApi;
  }
}

/** A plain facade over the Comlink proxy; `onProgress` is passed through `proxy`. */
export function connectEngine(
  endpoint: Endpoint,
): EngineApi & { dispose(): void } {
  const remote = wrap<EngineApi>(endpoint);
  return {
    palette: (version) => remote.palette(version),
    open: (request, onProgress) =>
      onProgress
        ? remote.open(request, proxy(onProgress))
        : remote.open(request),
    writeFiles: (files) => remote.writeFiles(files),
    apply: (command, revision) => remote.apply(command, revision),
    applyPatches: (patches, revision) => remote.applyPatches(patches, revision),
    project: (path, workflow) => remote.project(path, workflow),
    diagnostics: () => remote.diagnostics(),
    dispose: () => remote[releaseProxy](),
  };
}

let engine: EngineApi | undefined;

/** The engine in its module worker, started lazily. */
export function getEngine(): EngineApi {
  if (!engine) {
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), {
      type: "module",
      name: "engine",
    });
    worker.addEventListener("error", (event) => {
      console.error("Engine worker error", event.message);
    });
    engine = connectEngine(worker);
  }
  return engine;
}
