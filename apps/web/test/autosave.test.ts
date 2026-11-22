import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_DELAY_MS,
  createAutosaver,
  type Timer,
} from "../src/workspace/autosave";
import type { FileChange, SaveState } from "../src/workspace/types";

/** A manual clock: `advance` runs due callbacks in order. */
function manualTimer() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timer: Timer = {
    set: (fn, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...pending.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { timer, advance, count: () => pending.size };
}

/** A write whose completion the test controls. */
function harness() {
  const clock = manualTimer();
  const writes: FileChange[][] = [];
  const states: SaveState[] = [];
  const gates: { ok: () => void; fail: (m: string) => void }[] = [];
  let auto = true;
  let failNext: string | null = null;
  const write = (changes: readonly FileChange[]) => {
    writes.push([...changes]);
    if (failNext) {
      const message = failNext;
      failNext = null;
      return Promise.reject(new Error(message));
    }
    if (auto) return Promise.resolve();
    return new Promise<void>((resolve, reject) =>
      gates.push({ ok: resolve, fail: (m) => reject(new Error(m)) }),
    );
  };
  const saver = createAutosaver({
    write,
    onState: (s) => states.push(s),
    timer: clock.timer,
  });
  return {
    saver,
    clock,
    writes,
    states,
    gates,
    hold: () => {
      auto = false;
    },
    failOnce: (m: string) => {
      failNext = m;
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const f = (path: string, text: string | null) => ({ path, text });

describe("F-202 autosaver", () => {
  it("F-202 IO-01: a change is written 500 ms after the last applied change, never earlier", async () => {
    const h = harness();
    expect(AUTOSAVE_DELAY_MS).toBe(500);
    h.saver.record("p", [f("a.nf", "1")]);
    h.clock.advance(499);
    await settle();
    expect(h.writes).toHaveLength(0);
    // a second change at 499 restarts the wait
    h.saver.record("p", [f("a.nf", "2")]);
    h.clock.advance(499);
    await settle();
    expect(h.writes).toHaveLength(0);
    h.clock.advance(1);
    await settle();
    expect(h.writes).toEqual([[{ projectId: "p", path: "a.nf", text: "2" }]]);
  });

  it("F-202 IO-01: changes within 500 ms are coalesced into one write; the latest text per path wins; deletes are null", async () => {
    const h = harness();
    h.saver.record("p", [f("a.nf", "1"), f("b.nf", "b")]);
    h.saver.record("p", [f("a.nf", "2"), f("b.nf", null)]);
    h.saver.record("q", [f("a.nf", "q")]);
    h.clock.advance(500);
    await settle();
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toEqual(
      expect.arrayContaining([
        { projectId: "p", path: "a.nf", text: "2" },
        { projectId: "p", path: "b.nf", text: null },
        { projectId: "q", path: "a.nf", text: "q" },
      ]),
    );
    expect(h.writes[0]).toHaveLength(3);
  });

  it("F-202 step 2 IO-01: the state is saving from the first change until the write commits, then saved", async () => {
    const h = harness();
    h.hold();
    expect(h.saver.state()).toEqual({ status: "saved", error: null });
    h.saver.record("p", [f("a.nf", "1")]);
    expect(h.saver.state().status).toBe("saving");
    h.clock.advance(500);
    await settle();
    expect(h.saver.state().status).toBe("saving");
    h.gates[0]?.ok();
    await settle();
    expect(h.saver.state()).toEqual({ status: "saved", error: null });
    expect(h.states.map((s) => s.status)).toEqual(["saving", "saved"]);
  });

  it("F-202 IO-01: a failed write reports failed with its message, keeps the changes and retries them with the next change or flush", async () => {
    const h = harness();
    h.failOnce("disk full");
    h.saver.record("p", [f("a.nf", "1")]);
    h.clock.advance(500);
    await settle();
    expect(h.saver.state()).toEqual({ status: "failed", error: "disk full" });
    expect(h.clock.count()).toBe(0); // no timed retry
    // the next change retries the kept change together with the new one
    h.saver.record("p", [f("b.nf", "2")]);
    expect(h.saver.state().status).toBe("saving");
    h.clock.advance(500);
    await settle();
    expect(h.writes[1]).toHaveLength(2);
    expect(h.saver.state().status).toBe("saved");
    // flush retries a failure too, and a newer text beats the kept one
    h.failOnce("again");
    h.saver.record("p", [f("a.nf", "3")]);
    h.clock.advance(500);
    await settle();
    expect(h.saver.state().status).toBe("failed");
    expect(await h.saver.flush()).toEqual({ status: "saved", error: null });
    expect(h.writes[3]).toEqual([{ projectId: "p", path: "a.nf", text: "3" }]);
  });

  it("F-202 IO-01: a change recorded during a write goes into the next write and the state stays saving", async () => {
    const h = harness();
    h.hold();
    h.saver.record("p", [f("a.nf", "1")]);
    h.clock.advance(500);
    await settle();
    h.saver.record("p", [f("a.nf", "2")]);
    h.gates[0]?.ok();
    await settle();
    expect(h.saver.state().status).toBe("saving");
    h.clock.advance(500);
    await settle();
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]).toEqual([{ projectId: "p", path: "a.nf", text: "2" }]);
    h.gates[1]?.ok();
    await settle();
    expect(h.saver.state().status).toBe("saved");
  });

  it("F-202: flush writes at once; discard drops a project's pending changes", async () => {
    const h = harness();
    expect(await h.saver.flush()).toEqual({ status: "saved", error: null });
    expect(h.writes).toHaveLength(0);
    h.saver.record("p", [f("a.nf", "1")]);
    h.saver.record("q", [f("a.nf", "q")]);
    h.saver.discard("p");
    expect(await h.saver.flush()).toEqual({ status: "saved", error: null });
    expect(h.writes).toEqual([[{ projectId: "q", path: "a.nf", text: "q" }]]);
    expect(h.clock.count()).toBe(0);
    // discarding the only pending project returns to saved without a write
    h.saver.record("p", [f("a.nf", "2")]);
    h.saver.discard("p");
    expect(h.saver.state().status).toBe("saved");
    expect(h.clock.count()).toBe(0);
    h.clock.advance(1000);
    await settle();
    expect(h.writes).toHaveLength(1);
  });

  it("F-202 IO-01: flush waits for a write in progress, and a failed write for a discarded project is not kept", async () => {
    const h = harness();
    h.hold();
    h.saver.record("p", [f("a.nf", "1")]);
    h.clock.advance(500);
    await settle();
    let flushed = false;
    const flushing = h.saver.flush().then((s) => {
      flushed = true;
      return s;
    });
    await settle();
    expect(flushed).toBe(false);
    h.saver.discard("p");
    h.gates[0]?.fail("gone");
    expect(await flushing).toEqual({ status: "saved", error: null });
    expect(h.writes).toHaveLength(1);
  });
});
