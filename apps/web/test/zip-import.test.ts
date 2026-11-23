import { describe, expect, it, vi } from "vitest";
import {
  createZipImport,
  type ZipImportState,
  zipProjectName,
} from "../src/project/zip-import";
import type { ImportStageResult } from "../src/workspace/types";

const summary = (source: string, ignore = "", files = 3) => ({
  source,
  stripped: null,
  files,
  bytes: 10,
  skipped: [],
  ignore,
  ignoreProblems: [],
});
const ok = (id: string, source: string, ignore = ""): ImportStageResult => ({
  ok: true,
  id,
  summary: summary(source, ignore),
});

/** A fake timer that runs callbacks when told to. */
function fakeTimer() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    timer: {
      set: (fn: () => void) => {
        pending.set(next, fn);
        return next++;
      },
      clear: (h: unknown) => void pending.delete(h as number),
    },
    pending,
    fire() {
      for (const [h, fn] of [...pending]) {
        pending.delete(h);
        fn();
      }
    },
  };
}

function harness() {
  const states: ZipImportState[] = [];
  const t = fakeTimer();
  const stage = vi.fn<(f: Blob, n: string) => Promise<ImportStageResult>>();
  const restage =
    vi.fn<(id: string, i: string) => Promise<ImportStageResult>>();
  const discard = vi.fn<(id: string) => Promise<void>>(async () => undefined);
  const view = createZipImport({
    workspace: () => ({
      stageZip: stage,
      restageImport: restage,
      discardImport: discard,
    }),
    onChange: (s) => states.push(s),
    timer: t.timer,
  });
  return { view, states, t, stage, restage, discard };
}
const file = (name: string) => new File(["x"], name);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("F-403 zip import state", () => {
  it("F-403 IO-12: choosing a file shows reading, then the summary; a refusal shows its message", async () => {
    const h = harness();
    h.stage.mockResolvedValueOnce(ok("a", "a.zip"));
    h.view.choose(file("a.zip"));
    expect(h.states.at(-1)).toEqual({ status: "reading", name: "a.zip" });
    await tick();
    expect(h.states.at(-1)).toMatchObject({
      status: "ready",
      name: "a.zip",
      id: "a",
      updating: false,
    });
    h.stage.mockResolvedValueOnce({
      ok: false,
      code: "not-zip",
      message: "This file isn't a zip archive, or it is damaged.",
    });
    h.view.choose(file("b.zip"));
    await tick();
    expect(h.states.at(-1)).toEqual({
      status: "refused",
      name: "b.zip",
      message: "This file isn't a zip archive, or it is damaged.",
    });
  });

  it("F-403 IO-12: an ignore-list edit restages after 300 ms, and an older reply never replaces a newer one", async () => {
    const h = harness();
    h.stage.mockResolvedValueOnce(ok("a", "a.zip"));
    h.view.choose(file("a.zip"));
    await tick();
    const slow: { resolve?: (r: ImportStageResult) => void } = {};
    h.restage.mockImplementationOnce(
      () => new Promise((resolve) => (slow.resolve = resolve)),
    );
    h.view.setIgnore("one");
    expect(h.states.at(-1)).toMatchObject({ ignore: "one", updating: true });
    expect(h.restage).not.toHaveBeenCalled();
    h.view.setIgnore("one\ntwo"); // restarts the debounce
    expect(h.t.pending.size).toBe(1);
    h.t.fire();
    expect(h.restage).toHaveBeenCalledWith("a", "one\ntwo");
    h.view.setIgnore("three");
    h.restage.mockResolvedValueOnce(ok("a", "a.zip", "three"));
    h.t.fire();
    await tick();
    expect(h.states.at(-1)).toMatchObject({
      ignore: "three",
      updating: false,
      summary: { ignore: "three" },
    });
    slow.resolve?.(ok("a", "a.zip", "one\ntwo"));
    await tick();
    expect(h.states.at(-1)).toMatchObject({
      ignore: "three",
      summary: { ignore: "three" },
    });
  });

  it("F-403 IO-12: a reply for older ignore text leaves the summary updating until the newest text is answered", async () => {
    const h = harness();
    h.stage.mockResolvedValueOnce(ok("a", "a.zip"));
    h.view.choose(file("a.zip"));
    await tick();
    h.restage.mockResolvedValueOnce(ok("a", "a.zip", "one"));
    h.view.setIgnore("one");
    h.t.fire();
    h.view.setIgnore("one\ntwo"); // typed while the first restage is in flight
    await tick();
    expect(h.states.at(-1)).toMatchObject({
      ignore: "one\ntwo",
      summary: { ignore: "one" },
      updating: true,
    });
  });

  it("F-403: choosing another file, reset and a refusal discard the previous stage", async () => {
    const h = harness();
    h.stage.mockResolvedValueOnce(ok("a", "a.zip"));
    h.view.choose(file("a.zip"));
    await tick();
    h.stage.mockResolvedValueOnce(ok("b", "b.zip"));
    h.view.choose(file("b.zip"));
    expect(h.discard).toHaveBeenLastCalledWith("a");
    await tick();
    h.stage.mockResolvedValueOnce({ ok: false, code: "gone", message: "m" });
    h.view.choose(file("c.zip"));
    expect(h.discard).toHaveBeenLastCalledWith("b");
    await tick();
    h.stage.mockResolvedValueOnce(ok("d", "d.zip"));
    h.view.choose(file("d.zip"));
    await tick();
    h.view.reset();
    expect(h.discard).toHaveBeenLastCalledWith("d");
    expect(h.states.at(-1)).toEqual({ status: "empty" });
    h.view.choose(null);
    expect(h.states.at(-1)).toEqual({ status: "empty" });
  });

  it("F-403: a reply for a file that was replaced is discarded", async () => {
    const h = harness();
    const slow: { resolve?: (r: ImportStageResult) => void } = {};
    h.stage.mockImplementationOnce(
      () => new Promise((resolve) => (slow.resolve = resolve)),
    );
    h.view.choose(file("a.zip"));
    h.view.reset();
    slow.resolve?.(ok("late", "a.zip"));
    await tick();
    expect(h.discard).toHaveBeenCalledWith("late");
    expect(h.states.at(-1)).toEqual({ status: "empty" });
  });

  it("F-403 UX-60: zipProjectName drops .zip and keeps at most 100 characters", () => {
    expect(zipProjectName("rnaseq-nf-main.zip")).toBe("rnaseq-nf-main");
    expect(zipProjectName("Data.ZIP")).toBe("Data");
    expect(zipProjectName("x".repeat(150) + ".zip")).toHaveLength(100);
    expect(zipProjectName(".zip")).toBe("Untitled project");
  });
});
