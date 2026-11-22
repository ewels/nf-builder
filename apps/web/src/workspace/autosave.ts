// Autosave (F-202, IO-01): a trailing 500 ms debounce over every applied change. Changes are keyed by project and path, so
// the latest text wins and `null` deletes. The state is `saving` from the first change until the write commits. A failed
// write keeps its changes and waits for the next change or `flush`. Nothing here assumes a top-level page (ADR 0044).
import type { FileText } from "@nf-builder/engine";
import type { FileChange, SaveState } from "./types";

export const AUTOSAVE_DELAY_MS = 500;

export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface AutosaverOptions {
  readonly delayMs?: number;
  write(changes: readonly FileChange[]): Promise<void>;
  onState(state: SaveState): void;
  readonly timer?: Timer;
}

export interface Autosaver {
  record(projectId: string, files: readonly FileText[]): void;
  /** Writes everything pending at once, after any write in progress; resolves with the resulting state. */
  flush(): Promise<SaveState>;
  /** Drops a project's pending changes (it was deleted). */
  discard(projectId: string): void;
  state(): SaveState;
}

const SAVED: SaveState = { status: "saved", error: null };
const SAVING: SaveState = { status: "saving", error: null };
const keyOf = (c: { projectId: string; path: string }) =>
  JSON.stringify([c.projectId, c.path]);

export function createAutosaver(options: AutosaverOptions): Autosaver {
  const delay = options.delayMs ?? AUTOSAVE_DELAY_MS;
  const timer: Timer = options.timer ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  let pending = new Map<string, FileChange>();
  let handle: unknown;
  let armed = false;
  let current: SaveState = SAVED;
  let inflight: { changes: FileChange[]; done: Promise<void> } | null = null;

  const set = (next: SaveState) => {
    if (next.status === current.status && next.error === current.error) return;
    current = next;
    options.onState(next);
  };
  const disarm = () => {
    if (armed) timer.clear(handle);
    armed = false;
  };
  const arm = () => {
    disarm();
    armed = true;
    handle = timer.set(() => {
      armed = false;
      void drain();
    }, delay);
  };

  /** Writes what is pending, one write at a time, until nothing is left or a write fails. */
  const drain = async (): Promise<void> => {
    while (inflight) await inflight.done;
    if (pending.size === 0) return;
    disarm();
    const changes = [...pending.values()];
    pending = new Map();
    const entry = { changes, done: Promise.resolve() };
    inflight = entry;
    entry.done = (async () => {
      try {
        await options.write(changes);
        inflight = null;
        if (pending.size === 0) set(SAVED);
      } catch (error) {
        inflight = null;
        // keep what was not discarded; a newer pending text beats the kept one
        for (const c of entry.changes)
          if (!pending.has(keyOf(c))) pending.set(keyOf(c), c);
        if (pending.size === 0) {
          set(SAVED); // every changed project was discarded meanwhile
          return;
        }
        set({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    await entry.done;
  };

  return {
    record(projectId, files) {
      if (files.length === 0) return;
      for (const file of files) {
        const change = { projectId, path: file.path, text: file.text };
        pending.set(keyOf(change), change);
      }
      set(SAVING);
      arm();
    },

    async flush() {
      for (;;) {
        await drain();
        if (inflight) continue;
        if (pending.size === 0 || current.status === "failed") return current;
      }
    },

    discard(projectId) {
      for (const [k, c] of pending)
        if (c.projectId === projectId) pending.delete(k);
      if (inflight)
        inflight.changes = inflight.changes.filter(
          (c) => c.projectId !== projectId,
        );
      if (pending.size === 0) {
        disarm();
        if (!inflight) set(SAVED);
      }
    },

    state: () => current,
  };
}
