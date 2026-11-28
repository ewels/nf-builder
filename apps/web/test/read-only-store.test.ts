import { describe, expect, it, vi } from "vitest";
import {
  createReadOnlyStore,
  type MediaWatch,
  WIDE_QUERY,
} from "../src/read-only/read-only-store";

type Listener = (e: { readonly matches: boolean }) => void;

function fakeMedia(matches: boolean) {
  const listeners = new Set<Listener>();
  const media = {
    matches,
    addEventListener: (_t: "change", l: Listener) => void listeners.add(l),
    removeEventListener: (_t: "change", l: Listener) =>
      void listeners.delete(l),
  } satisfies MediaWatch;
  return {
    media,
    listeners,
    set(next: boolean) {
      media.matches = next;
      for (const l of [...listeners]) l({ matches: next });
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => {
  let resolve: () => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("F-703 read-only store", () => {
  it("F-703 UX-04: the app starts read-only below 1024 px and editable at 1024 px and wider", () => {
    expect(WIDE_QUERY).toBe("(min-width: 1024px)");
    const narrow = createReadOnlyStore(() => fakeMedia(false).media);
    const wide = createReadOnlyStore(() => fakeMedia(true).media);
    expect(narrow.getState().readOnly).toBe(true);
    expect(wide.getState().readOnly).toBe(false);
  });

  it("F-703 UX-04: without matchMedia the app is editable", () => {
    const store = createReadOnlyStore(() => null);
    expect(store.getState().readOnly).toBe(false);
    const stop = store
      .getState()
      .start({ flush: async () => undefined, onEnter: () => undefined });
    expect(() => stop()).not.toThrow();
  });

  it("F-703 UX-04 ADR-0004: narrowing turns read-only only after the pending code edits are sent, then calls onEnter once", async () => {
    const f = fakeMedia(true);
    const store = createReadOnlyStore(() => f.media);
    const gate = deferred();
    const flush = vi.fn(() => gate.promise);
    const onEnter = vi.fn();
    store.getState().start({ flush, onEnter });
    f.set(false);
    await settle();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(store.getState().readOnly).toBe(false);
    expect(onEnter).not.toHaveBeenCalled();
    gate.resolve();
    await settle();
    expect(store.getState().readOnly).toBe(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("F-703 UX-04: widening turns editing back on at once, and widening during a pending flush cancels the narrowing", async () => {
    const f = fakeMedia(false);
    const store = createReadOnlyStore(() => f.media);
    const gate = deferred();
    const onEnter = vi.fn();
    store.getState().start({ flush: () => gate.promise, onEnter });
    expect(store.getState().readOnly).toBe(true);
    f.set(true);
    expect(store.getState().readOnly).toBe(false);
    f.set(false);
    f.set(true);
    gate.resolve();
    await settle();
    expect(store.getState().readOnly).toBe(false);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("F-703: a failing flush still turns read-only, and stop removes the listener", async () => {
    const f = fakeMedia(true);
    const store = createReadOnlyStore(() => f.media);
    const onEnter = vi.fn();
    const stop = store.getState().start({
      flush: () => Promise.reject(new Error("worker gone")),
      onEnter,
    });
    expect(f.listeners.size).toBe(1);
    f.set(false);
    await settle();
    expect(store.getState().readOnly).toBe(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
    stop();
    expect(f.listeners.size).toBe(0);
  });
});
