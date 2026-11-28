// Worker side of the Comlink bridge (F-113, F-202, ADR 0003). Comlink lives in apps/web only; the workspace and the engine
// service stay pure.
import { type Endpoint, expose, releaseProxy, transfer } from "comlink";
import type { WorkspaceApi } from "../workspace/types";

const release = (callback: unknown) => {
  (callback as { [releaseProxy]?: () => void } | undefined)?.[releaseProxy]?.();
};

/**
 * Exposes `api` on `endpoint`. The progress callback's proxy is released when `open` settles; a `watch` listener's proxy is
 * released when a later `watch` replaces it.
 */
export function exposeEngine(api: WorkspaceApi, endpoint: Endpoint): void {
  let watcher: unknown;
  const exposed: WorkspaceApi = {
    ...api,
    open: (request, onProgress) =>
      api.open(request, onProgress).finally(() => release(onProgress)),
    // the zip's buffer moves to the page instead of being copied (F-404)
    exportProject: async (options) => {
      const result = await api.exportProject(options);
      return result.ok ? transfer(result, [result.bytes.buffer]) : result;
    },
    watch: (listener) => {
      release(watcher);
      watcher = listener;
      return api.watch(listener);
    },
  };
  expose(exposed, endpoint);
}
