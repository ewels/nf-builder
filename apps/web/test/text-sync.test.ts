import type { ApplyOutcome } from "@nf-builder/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTextSync,
  SYNC_DELAY_MS,
  type SyncState,
  withoutText,
} from "../src/code/text-sync";

const ok = { ok: true } as unknown as ApplyOutcome;
const refusal = (
  code: string,
  extra: Record<string, unknown> = {},
): ApplyOutcome =>
  ({
    ok: false,
    revision: 1,
    code,
    message: `refused ${code}`,
    path: "main.nf",
    problems: [],
    ...extra,
  }) as unknown as ApplyOutcome;

/** A `send` the test settles by hand. */
function gated() {
  const sent: string[] = [];
  const waiting: ((outcome: ApplyOutcome) => void)[] = [];
  return {
    sent,
    send: (text: string) => {
      sent.push(text);
      return new Promise<ApplyOutcome>((resolve) => waiting.push(resolve));
    },
    settle: (outcome: ApplyOutcome = ok) => waiting.shift()?.(outcome),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("F-208 text sync", () => {
  it("F-208: an edit is sent once, 300 ms after the last change", async () => {
    const g = gated();
    const sync = createTextSync("a", {
      send: g.send,
      onState: () => undefined,
    });
    expect(SYNC_DELAY_MS).toBe(300);
    sync.edit("ab");
    await vi.advanceTimersByTimeAsync(200);
    sync.edit("abc");
    await vi.advanceTimersByTimeAsync(200);
    expect(g.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(g.sent).toEqual(["abc"]);
    g.settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(g.sent).toEqual(["abc"]);
  });

  it("F-208: one request in flight; the latest text follows when it settles; a text equal to the synced one is not sent", async () => {
    const g = gated();
    const states: SyncState[] = [];
    const sync = createTextSync("a", {
      send: g.send,
      onState: (s) => states.push(s),
    });
    sync.edit("b");
    await vi.advanceTimersByTimeAsync(300);
    sync.edit("c");
    await vi.advanceTimersByTimeAsync(300);
    expect(g.sent).toEqual(["b"]);
    g.settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(g.sent).toEqual(["b", "c"]);
    g.settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({ status: "idle" });
    // back to the synced text: nothing to send
    sync.edit("d");
    sync.edit("c");
    await vi.advanceTimersByTimeAsync(1000);
    expect(g.sent).toEqual(["b", "c"]);
  });

  it("F-208 AR-24: a refusal reports its message and problems for the text sent; the next accepted edit returns to idle", async () => {
    const g = gated();
    const states: SyncState[] = [];
    const problems = [{ message: "bad" }];
    const sync = createTextSync("a", {
      send: g.send,
      onState: (s) => states.push(s),
    });
    sync.edit("x(");
    await vi.advanceTimersByTimeAsync(300);
    g.settle(refusal("does-not-parse", { problems }));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({
      status: "refused",
      message: "refused does-not-parse",
      problems,
      text: "x(",
    });
    sync.edit("x()");
    await vi.advanceTimersByTimeAsync(300);
    g.settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({ status: "idle" });
    // any other refusal is a failure
    sync.edit("y");
    await vi.advanceTimersByTimeAsync(300);
    g.settle(refusal("not-found"));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({
      status: "failed",
      message: "refused not-found",
    });
  });

  it("F-208: a stale refusal is retried once; flush sends at once; dispose cancels the timer", async () => {
    const g = gated();
    const sync = createTextSync("a", {
      send: g.send,
      onState: () => undefined,
    });
    sync.edit("b");
    const flushed = sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(g.sent).toEqual(["b"]);
    g.settle(refusal("stale"));
    await vi.advanceTimersByTimeAsync(0);
    expect(g.sent).toEqual(["b", "b"]);
    g.settle(refusal("stale"));
    await flushed;
    expect(g.sent).toEqual(["b", "b"]);
    sync.edit("c");
    sync.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(g.sent).toEqual(["b", "b"]);
  });

  it("F-208: reset adopts a new synced text and drops a pending edit", async () => {
    const g = gated();
    const sync = createTextSync("a", {
      send: g.send,
      onState: () => undefined,
    });
    sync.edit("b");
    sync.reset("z");
    await vi.advanceTimersByTimeAsync(1000);
    expect(g.sent).toEqual([]);
    sync.edit("z");
    await vi.advanceTimersByTimeAsync(1000);
    expect(g.sent).toEqual([]);
  });

  it("F-208 ADR-0004 IO-01: nothing is sent after dispose, and a stale refusal is not retried", async () => {
    const g = gated();
    const sync = createTextSync("a", {
      send: g.send,
      onState: () => undefined,
    });
    sync.edit("b");
    void sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(g.sent).toEqual(["b"]);
    sync.edit("c");
    await vi.advanceTimersByTimeAsync(300);
    sync.dispose();
    g.settle(refusal("stale"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(g.sent).toEqual(["b"]);
    sync.edit("d");
    await sync.flush();
    expect(g.sent).toEqual(["b"]);
  });
});

describe("F-208 sync status", () => {
  it("F-208 ADR-0004: the status shown in the pane carries no file text", () => {
    const refused: SyncState = {
      status: "refused",
      message: "no",
      problems: [],
      text: "secret",
    };
    expect(withoutText(refused)).toEqual({
      status: "refused",
      message: "no",
      problems: [],
    });
    expect(JSON.stringify(withoutText(refused))).not.toContain("secret");
    expect(withoutText({ status: "idle" })).toEqual({ status: "idle" });
  });
});
