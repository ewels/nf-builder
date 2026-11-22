// Worker side of the Comlink bridge (F-113, ADR 0003). Comlink lives in apps/web only; the engine service stays pure.
import type { EngineApi } from "@nf-builder/engine";
import { type Endpoint, expose, releaseProxy } from "comlink";

/** Exposes `api` on `endpoint`. The progress callback's proxy is released when `open` settles. */
export function exposeEngine(api: EngineApi, endpoint: Endpoint): void {
  const release = (callback: unknown) => {
    (callback as { [releaseProxy]?: () => void } | undefined)?.[
      releaseProxy
    ]?.();
  };
  const exposed: EngineApi = {
    ...api,
    open: (request, onProgress) =>
      api.open(request, onProgress).finally(() => release(onProgress)),
  };
  expose(exposed, endpoint);
}
