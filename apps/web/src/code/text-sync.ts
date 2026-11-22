// Sends the editor's text to the engine as whole-file ReplaceFileText commands (F-208, AR-24, ADR 0039). Pure: the
// timers and the send function are injected. A refused text is kept by the editor; this only reports the refusal.
import type { ApplyOutcome, ParseProblem } from "@nf-builder/engine";

export const SYNC_DELAY_MS = 300;

export type SyncState =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | {
      readonly status: "refused";
      readonly message: string;
      readonly problems: readonly ParseProblem[];
      /** The text that was refused. */
      readonly text: string;
    }
  | { readonly status: "failed"; readonly message: string };

export interface TextSyncOptions {
  readonly delayMs: number;
  send(text: string): Promise<ApplyOutcome>;
  onState(state: SyncState): void;
  readonly timers?: {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}

export interface TextSync {
  /** The buffer changed: re-arms the debounce. */
  edit(text: string): void;
  /** Sends the latest text now; resolves when nothing is left to send. */
  flush(): Promise<void>;
  /** The project's text changed under a clean buffer: adopt it and drop any pending edit. */
  reset(synced: string): void;
  dispose(): void;
}

const defaultTimers = {
  set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clear: (handle: unknown): void =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createTextSync(
  synced: string,
  options: TextSyncOptions,
): TextSync {
  const timers = options.timers ?? defaultTimers;
  let syncedText = synced;
  /** The newest text not yet known to be applied. */
  let latest: string | null = null;
  let timer: unknown = null;
  let wanted = false;
  let running: Promise<void> | null = null;
  let disposed = false;

  const cancelTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  async function sendOnce(text: string): Promise<ApplyOutcome | Error> {
    try {
      return await options.send(text);
    } catch (error) {
      return error instanceof Error ? error : new Error(messageOf(error));
    }
  }

  async function loop(): Promise<void> {
    await Promise.resolve();
    try {
      while (wanted) {
        wanted = false;
        if (latest === null || latest === syncedText) continue;
        const sent = latest;
        let outcome = await sendOnce(sent);
        // another writer got in first: one more try, on the revision the engine now holds
        if (
          !(outcome instanceof Error) &&
          !outcome.ok &&
          outcome.code === "stale"
        )
          outcome = await sendOnce(sent);
        if (disposed) continue;
        if (outcome instanceof Error)
          options.onState({ status: "failed", message: outcome.message });
        else if (outcome.ok) {
          syncedText = sent;
          if (latest === sent) {
            latest = null;
            options.onState({ status: "idle" });
          }
        } else if (
          outcome.code === "does-not-parse" ||
          outcome.code === "mixed-definitions"
        )
          options.onState({
            status: "refused",
            message: outcome.message,
            problems: outcome.problems,
            text: sent,
          });
        else options.onState({ status: "failed", message: outcome.message });
      }
    } finally {
      running = null;
    }
  }

  const request = (): Promise<void> => {
    wanted = true;
    running ??= loop();
    return running;
  };

  return {
    edit(text) {
      if (disposed) return;
      latest = text;
      cancelTimer();
      if (text === syncedText && running === null) {
        latest = null;
        options.onState({ status: "idle" });
        return;
      }
      options.onState({ status: "pending" });
      timer = timers.set(() => {
        timer = null;
        void request();
      }, options.delayMs);
    },
    async flush() {
      cancelTimer();
      if (latest !== null && latest !== syncedText) await request();
      else await running;
    },
    reset(text) {
      cancelTimer();
      syncedText = text;
      latest = null;
      options.onState({ status: "idle" });
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
