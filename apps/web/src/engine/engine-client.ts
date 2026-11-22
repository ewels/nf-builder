// Main-thread side of the Comlink bridge (F-113, ADR 0003). The worker starts on the first `getEngine()`, never at import.
import type { EngineApi } from "@nf-builder/engine";
import { type Endpoint, proxy, releaseProxy, wrap } from "comlink";

/**
 * A plain facade over the Comlink proxy; `onProgress` is passed through `proxy`. Every call is raced against `failed`
 * (the worker could not load or crashed), so a call never waits for a worker that will not answer.
 */
export function connectEngine(
  endpoint: Endpoint,
  failed?: Promise<never>,
): EngineApi & { dispose(): void } {
  const remote = wrap<EngineApi>(endpoint);
  const race = <P extends Promise<unknown>>(call: P): P =>
    (failed ? Promise.race([call, failed]) : call) as P;
  return {
    palette: (version) => race(remote.palette(version)),
    open: (request, onProgress) =>
      race(remote.open(request, onProgress && proxy(onProgress))),
    writeFiles: (files) => race(remote.writeFiles(files)),
    apply: (command, revision) => race(remote.apply(command, revision)),
    applyPatches: (patches, revision) =>
      race(remote.applyPatches(patches, revision)),
    project: (path, workflow) => race(remote.project(path, workflow)),
    diagnostics: () => race(remote.diagnostics()),
    readFile: (path) => race(remote.readFile(path)),
    close: () => race(remote.close()),
    dispose: () => remote[releaseProxy](),
  };
}

let engine: EngineApi | undefined;

/** The engine in its module worker, started lazily. After a load failure the next call starts a new worker. */
export function getEngine(): EngineApi {
  if (!engine) {
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), {
      type: "module",
      name: "engine",
    });
    let fail: (reason: Error) => void = () => undefined;
    const failed = new Promise<never>((_, reject) => {
      fail = reject;
    });
    failed.catch(() => undefined); // calls that race it handle the rejection; this one is only a guard
    const current = connectEngine(worker, failed);
    const onFailure = (kind: string, detail: string | undefined) => {
      console.error(`Engine worker ${kind}`, detail);
      if (engine === current) engine = undefined;
      worker.terminate();
      fail(
        new Error(
          `The engine worker failed (${kind}): ${detail ?? "no detail"}`,
        ),
      );
    };
    worker.addEventListener("error", (event) =>
      onFailure("error", event.message),
    );
    worker.addEventListener("messageerror", () =>
      onFailure("messageerror", undefined),
    );
    engine = current;
  }
  return engine;
}
