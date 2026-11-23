// Main-thread side of the Comlink bridge (F-113, ADR 0003). The worker starts on the first `getEngine()`, never at import.

import type { EngineRefusal, ProjectChange } from "@nf-builder/engine";
import { type Endpoint, proxy, releaseProxy, wrap } from "comlink";
import type { WorkspaceApi } from "../workspace/types";

/**
 * A plain facade over the Comlink proxy; `onProgress` and the `watch` listener are passed through `proxy`. Every call is raced against `failed`
 * (the worker could not load or crashed), so a call never waits for a worker that will not answer.
 */
export function connectEngine(
  endpoint: Endpoint,
  failed?: Promise<never>,
): WorkspaceApi & { dispose(): void } {
  const remote = wrap<WorkspaceApi>(endpoint);
  const race = <P extends Promise<unknown>>(call: P): P =>
    (failed ? Promise.race([call, failed]) : call) as P;
  return {
    palette: (version) => race(remote.palette(version)),
    templates: (version) => race(remote.templates(version)),
    open: (request, onProgress) =>
      race(remote.open(request, onProgress && proxy(onProgress))),
    writeFiles: (files) => race(remote.writeFiles(files)),
    apply: (command, revision, options) =>
      race(remote.apply(command, revision, options)),
    applyFix: (fix, revision, options) =>
      race(remote.applyFix(fix, revision, options)),
    undo: (revision) => race(remote.undo(revision)),
    redo: (revision) => race(remote.redo(revision)),
    history: () => race(remote.history()),
    applyPatches: (patches, revision) =>
      race(remote.applyPatches(patches, revision)),
    project: (path, workflow) => race(remote.project(path, workflow)),
    diagnostics: () => race(remote.diagnostics()),
    details: (path, workflow, node) =>
      race(remote.details(path, workflow, node)),
    setLayout: (write) => race(remote.setLayout(write)),
    readFile: (path) => race(remote.readFile(path)),
    close: () => race(remote.close()),
    watch: (listener) => race(remote.watch(proxy(listener))),
    stageZip: (file, name) => race(remote.stageZip(file, name)),
    restageImport: (id, ignore) => race(remote.restageImport(id, ignore)),
    discardImport: (id) => race(remote.discardImport(id)),
    createProject: (input) => race(remote.createProject(input)),
    openProject: (id) => race(remote.openProject(id)),
    renameProject: (id, name) => race(remote.renameProject(id, name)),
    deleteProject: (id) => race(remote.deleteProject(id)),
    flush: () => race(remote.flush()),
    dispose: () => remote[releaseProxy](),
  };
}

const changeListeners = new Set<(change: ProjectChange) => void>();

/** Calls `listener` after every successful write or edit made through `getEngine()`, hooks included (F-205). */
export function onEngineChange(
  listener: (change: ProjectChange) => void,
): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

const announced = <R extends ProjectChange | EngineRefusal>(result: R): R => {
  if ("files" in result)
    for (const listener of changeListeners) listener(result);
  return result;
};

/** The facade whose writes and edits notify `onEngineChange` listeners. */
function withChangeEvents<E extends WorkspaceApi>(api: E): E {
  return {
    ...api,
    writeFiles: async (files) => announced(await api.writeFiles(files)),
    apply: async (command, revision, options) =>
      announced(await api.apply(command, revision, options)),
    applyFix: async (fix, revision, options) =>
      announced(await api.applyFix(fix, revision, options)),
    undo: async (revision) => announced(await api.undo(revision)),
    redo: async (revision) => announced(await api.redo(revision)),
    applyPatches: async (patches, revision) =>
      announced(await api.applyPatches(patches, revision)),
  };
}

let engine: WorkspaceApi | undefined;

/** The engine in its module worker, started lazily. After a load failure the next call starts a new worker. */
export function getEngine(): WorkspaceApi {
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
    const current = withChangeEvents(connectEngine(worker, failed));
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
