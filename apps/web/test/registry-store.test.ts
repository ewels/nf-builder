import type {
  RegistryClient,
  RegistryFailure,
  RegistryIndex,
} from "@nf-builder/sources";
import { RegistryError } from "@nf-builder/sources";
import { describe, expect, it } from "vitest";
import { createRegistryStore } from "../src/registry/registry-store";

const indexOf = (source: "live" | "snapshot", asOf: string): RegistryIndex => ({
  source,
  asOf,
  snapshotAt: asOf,
  language: "26.10",
  nextflow: "26.10.7",
  modules: [],
  plugins: [],
  liveFailure: null,
});
const failure: RegistryFailure = { code: "network", message: "offline" };

/** A fake client whose reads are answered in order by `script`. */
function fake(
  source: "live" | "snapshot",
  script: (RegistryIndex | RegistryFailure)[],
) {
  const reads: { refresh: boolean }[] = [];
  const client: RegistryClient = {
    source,
    ports: async () => null,
    async index(options) {
      reads.push({ refresh: options?.refresh === true });
      const next = script.shift();
      if (!next) throw new Error("script exhausted");
      if ("code" in next)
        throw new RegistryError(next.code, "https://x.test/", next.message);
      return next;
    },
  };
  return { client, reads };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("registry store", () => {
  it("F-502 UX-14: load() reads once; a second load() is a no-op", async () => {
    const made: boolean[] = [];
    const f = fake("snapshot", [indexOf("snapshot", "2026-11-22T00:00:00Z")]);
    const store = createRegistryStore((live) => {
      made.push(live);
      return f.client;
    });
    expect(store.getState().state.status).toBe("idle");
    expect(made).toEqual([]);
    store.getState().load();
    expect(store.getState().state.status).toBe("loading");
    store.getState().load();
    await settle();
    store.getState().load();
    expect(f.reads).toHaveLength(1);
    expect(made).toEqual([false]);
    const state = store.getState().state;
    expect(state.status === "ready" && state.index.source).toBe("snapshot");
  });

  it("F-502 UX-14: refresh() keeps the index while refreshing and on failure, and records refreshFailure", async () => {
    const first = indexOf("snapshot", "2026-11-22T00:00:00Z");
    const second = indexOf("snapshot", "2026-11-23T00:00:00Z");
    const f = fake("snapshot", [first, failure, second]);
    const store = createRegistryStore(() => f.client);
    store.getState().load();
    await settle();

    store.getState().refresh();
    let state = store.getState().state;
    expect(state.status === "ready" && state.refreshing).toBe(true);
    expect(state.status === "ready" && state.index).toBe(first);
    await settle();
    state = store.getState().state;
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.refreshing).toBe(false);
    expect(state.index).toBe(first);
    expect(state.refreshFailure?.code).toBe("network");
    expect(f.reads[1]).toEqual({ refresh: true });

    store.getState().refresh();
    await settle();
    state = store.getState().state;
    expect(state.status === "ready" && state.index).toBe(second);
    expect(state.status === "ready" && state.refreshFailure).toBeNull();
  });

  it("F-502 IO-30: a failed first load records the failure, and refresh() retries", async () => {
    const good = indexOf("snapshot", "2026-11-22T00:00:00Z");
    const f = fake("snapshot", [failure, good]);
    const store = createRegistryStore(() => f.client);
    store.getState().load();
    await settle();
    const failed = store.getState().state;
    expect(failed.status).toBe("failed");
    expect(failed.status === "failed" && failed.failure.code).toBe("network");
    store.getState().refresh();
    const retrying = store.getState().state;
    expect(retrying.status === "failed" && retrying.refreshing).toBe(true);
    await settle();
    const state = store.getState().state;
    expect(state.status === "ready" && state.index).toBe(good);
  });

  it("F-502 IO-30: reload({ live: true }) builds a live client and reads again", async () => {
    const made: boolean[] = [];
    const snap = fake("snapshot", [
      indexOf("snapshot", "2026-11-22T00:00:00Z"),
    ]);
    const live = fake("live", [indexOf("live", "2026-11-23T10:00:00Z")]);
    const store = createRegistryStore((l) => {
      made.push(l);
      return l ? live.client : snap.client;
    });
    store.getState().load();
    await settle();
    await store.getState().reload({ live: true });
    expect(made).toEqual([false, true]);
    const state = store.getState().state;
    expect(state.status === "ready" && state.index.source).toBe("live");
  });

  /** A client whose first read is answered by hand. */
  function deferred() {
    let resolve: (index: RegistryIndex) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const client: RegistryClient = {
      source: "snapshot",
      ports: async () => null,
      index: () =>
        new Promise<RegistryIndex>((res, rej) => {
          resolve = res;
          reject = rej;
        }),
    };
    return {
      client,
      resolve: (i: RegistryIndex) => resolve(i),
      reject: (e: unknown) => reject(e),
    };
  }

  it("F-502 IO-30: a first load that resolves after reload({ live: true }) is ignored, and the live index stays", async () => {
    const slow = deferred();
    const live = fake("live", [indexOf("live", "2026-11-23T10:00:00Z")]);
    const store = createRegistryStore((l) => (l ? live.client : slow.client));
    store.getState().load();
    await store.getState().reload({ live: true });
    slow.resolve(indexOf("snapshot", "2026-11-22T00:00:00Z"));
    await settle();
    const state = store.getState().state;
    expect(state.status === "ready" && state.index.source).toBe("live");
  });

  it("F-502 IO-30: a first load that fails after reload({ live: true }) is ignored, and the live index stays", async () => {
    const slow = deferred();
    const live = fake("live", [indexOf("live", "2026-11-23T10:00:00Z")]);
    const store = createRegistryStore((l) => (l ? live.client : slow.client));
    store.getState().load();
    await store.getState().reload({ live: true });
    slow.reject(new TypeError("Failed to fetch"));
    await settle();
    const state = store.getState().state;
    expect(state.status === "ready" && state.index.source).toBe("live");
  });

  it("F-502 UX-14: every error code reaches the view state, for a first load and for a refresh", async () => {
    for (const code of ["unavailable", "invalid", "http", "timeout"] as const) {
      const failure: RegistryFailure = { code, message: code };
      const good = indexOf("snapshot", "2026-11-22T00:00:00Z");
      const f = fake("snapshot", [failure, good, failure]);
      const store = createRegistryStore(() => f.client);
      store.getState().load();
      await settle();
      const failed = store.getState().state;
      expect(failed.status === "failed" && failed.failure.code).toBe(code);
      store.getState().refresh();
      await settle();
      store.getState().refresh();
      await settle();
      const state = store.getState().state;
      expect(state.status === "ready" && state.refreshFailure?.code).toBe(code);
    }
  });
});
