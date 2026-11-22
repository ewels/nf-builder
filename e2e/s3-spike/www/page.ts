import type { JsonRpcMessage } from "../lsp-framing.ts";
import type {
  PageToWorker,
  Variant,
  WorkerStage,
  WorkerToPage,
} from "../protocol.ts";
import { runSession, type SessionResult } from "../session.ts";

export type PageRun = {
  variant: Variant;
  workerCreatedAt: number;
  /** Page clock at receipt. */
  marks: Partial<Record<WorkerStage, number>>;
  session: SessionResult | null;
  error: string | null;
  /** "<effectiveDirective> <blockedURI>", page and worker. */
  cspViolations: string[];
  longTasks: { count: number; maxMs: number };
  workers: number;
  /** cjGetRuntimeResources() after the session. */
  runtimeResources: string | null;
};

type RunOptions = {
  edits: number;
  timeoutMs: number;
  preloadResources?: Record<string, number[]>;
};

declare global {
  interface Window {
    s3Spike: { run(variant: Variant, options: RunOptions): Promise<PageRun> };
  }
}

async function run(variant: Variant, options: RunOptions): Promise<PageRun> {
  const fixtureText = await (await fetch("/fixture.nf")).text();
  const result: PageRun = {
    variant,
    workerCreatedAt: 0,
    marks: {},
    session: null,
    error: null,
    cspViolations: [],
    longTasks: { count: 0, maxMs: 0 },
    workers: 1,
    runtimeResources: null,
  };
  const onViolation = (event: SecurityPolicyViolationEvent): void => {
    result.cspViolations.push(
      `${event.effectiveDirective} ${event.blockedURI}`,
    );
  };
  document.addEventListener("securitypolicyviolation", onViolation);
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      result.longTasks.count++;
      result.longTasks.maxMs = Math.max(result.longTasks.maxMs, entry.duration);
    }
  });
  observer.observe({ entryTypes: ["longtask"] });

  result.workerCreatedAt = performance.now();
  const worker = new Worker(new URL("./lsp-worker.ts", import.meta.url));
  const toWorker = (message: PageToWorker): void => worker.postMessage(message);
  let listener: (message: JsonRpcMessage) => void = () => {};
  let resourcesWaiter: ((json: string) => void) | null = null;
  let fail: (error: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  worker.onmessage = (event: MessageEvent<WorkerToPage>) => {
    const data = event.data;
    if (data.type === "mark") result.marks[data.stage] = performance.now();
    else if (data.type === "message") listener(data.message);
    else if (data.type === "csp")
      result.cspViolations.push(`${data.directive} ${data.blockedURI}`);
    else if (data.type === "runtimeResources") resourcesWaiter?.(data.json);
    else fail(new Error(`${data.stage}: ${data.message}`));
  };
  worker.onerror = (event) => {
    fail(new Error(`worker error: ${event.message}`));
  };

  try {
    toWorker({
      type: "start",
      variant,
      ...(options.preloadResources
        ? { preloadResources: options.preloadResources }
        : {}),
    });
    result.session = await Promise.race([
      runSession(
        {
          send: (message) => toWorker({ type: "send", message }),
          onMessage: (l) => {
            listener = l;
          },
        },
        {
          fixtureText,
          edits: options.edits,
          now: () => performance.now(),
          timeoutMs: options.timeoutMs,
        },
      ),
      failed,
    ]);
    result.runtimeResources = await Promise.race([
      new Promise<string>((resolve) => {
        resourcesWaiter = resolve;
        toWorker({ type: "runtimeResources" });
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    worker.terminate();
    observer.disconnect();
    document.removeEventListener("securitypolicyviolation", onViolation);
  }
  const log = document.getElementById("log");
  if (log) log.textContent = result.error ?? "done";
  return result;
}

window.s3Spike = { run };
