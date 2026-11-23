// ELK in its own worker (F-207, ADR 0008, ADR 0003). elkjs's worker takes over `self.onmessage`, so it can't share the
// Comlink engine worker; it is a classic worker speaking ELK's own protocol, started on the first call and never in the
// initial bundle (QA-01). elk-api is imported on that first call too.
import type { ElkGraphIn, ElkGraphOut } from "@nf-builder/engine";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";

export type ElkRunner = (graph: ElkGraphIn) => Promise<ElkGraphOut>;

interface Started {
  readonly layout: (graph: ElkGraphIn) => Promise<ElkGraphOut>;
  readonly terminate: () => void;
  /** Rejects when the worker fails to load or crashes: ELK's own promises never settle then. */
  readonly failed: Promise<never>;
}

let started: Promise<Started> | undefined;
let active: Started | undefined;

function start(): Promise<Started> {
  const attempt: Promise<Started> = import("elkjs/lib/elk-api.js").then(
    ({ default: ELK }) => {
      let fail: (reason: Error) => void = () => undefined;
      const failed = new Promise<never>((_, reject) => {
        fail = reject;
      });
      failed.catch(() => undefined); // calls that race it handle the rejection; this is only a guard
      let elk: InstanceType<typeof ELK> | undefined;
      const stop = () => {
        elk?.terminateWorker();
        if (started === attempt) {
          started = undefined;
          active = undefined;
        }
      };
      const onFailure = (detail: string) => {
        stop();
        fail(new Error(`The ELK worker failed (${detail})`));
      };
      elk = new ELK({
        workerUrl: elkWorkerUrl,
        workerFactory: (url) => {
          const worker = new Worker(url as string);
          worker.addEventListener("error", (event) =>
            onFailure(event.message || "no detail"),
          );
          worker.addEventListener("messageerror", () =>
            onFailure("messageerror"),
          );
          return worker;
        },
      });
      const run: Started = {
        // the graph is plain JSON; ELK's own typings ask for its node type
        layout: (graph) =>
          elk?.layout(graph as never) as unknown as Promise<ElkGraphOut>,
        terminate: stop,
        failed,
      };
      active = run;
      return run;
    },
  );
  // a failed start (a blocked Worker constructor) is not kept, so the next call tries again
  attempt.catch(() => {
    if (started === attempt) started = undefined;
  });
  return attempt;
}

/** Lays out `graph` in the ELK worker. Rejects when the worker can't start or fails; the next call starts a new one. */
export const runElk: ElkRunner = async (graph) => {
  started ??= start();
  const run = await started;
  return Promise.race([run.layout(graph), run.failed]);
};

/** Stops the worker, if one is running. */
export function disposeElk(): void {
  const run = active;
  started = undefined;
  active = undefined;
  run?.terminate();
}
