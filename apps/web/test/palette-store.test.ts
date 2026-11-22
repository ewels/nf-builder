import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createPaletteStore,
  DEFAULT_OPEN,
  PALETTE_STORAGE_KEY,
} from "../src/palette/palette-store";

function memory(seed?: Record<string, string>) {
  const data = new Map(Object.entries(seed ?? {}));
  const storage: StateStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
  return { data, storage };
}
const fresh = (seed?: Record<string, string>) => {
  const m = memory(seed);
  return { ...m, store: createPaletteStore(() => m.storage) };
};
const seeded = (value: unknown) =>
  fresh({
    [PALETTE_STORAGE_KEY]:
      typeof value === "string" ? value : JSON.stringify(value),
  });

describe("palette store", () => {
  it("F-204 step 1 ADR-0028: Processes, Workflows and Operators start open", () => {
    expect(DEFAULT_OPEN).toEqual(["processes", "workflows", "operators"]);
    expect(fresh().store.getState().open).toEqual(DEFAULT_OPEN);
  });

  it("F-204 step 1 ADR-0028: toggleCategory opens a closed category and closes an open one, leaving the others", () => {
    const { store } = fresh();
    store.getState().toggleCategory("factories");
    expect(store.getState().open).toEqual([
      "processes",
      "workflows",
      "factories",
      "operators",
    ]);
    store.getState().toggleCategory("processes");
    expect(store.getState().open).toEqual([
      "workflows",
      "factories",
      "operators",
    ]);
  });

  it("F-204 step 1 ADR-0028: the open set is stored under nf-builder:palette as version 1", () => {
    const { store, data } = fresh();
    store.getState().toggleCategory("factories");
    expect(PALETTE_STORAGE_KEY).toBe("nf-builder:palette");
    expect(JSON.parse(data.get(PALETTE_STORAGE_KEY) ?? "null")).toEqual({
      state: { open: ["processes", "workflows", "factories", "operators"] },
      version: 1,
    });
  });

  it("F-204 step 1 ADR-0028: a new store starts from the stored set (reload)", () => {
    const { store } = seeded({
      state: { open: ["plugins-config"] },
      version: 1,
    });
    expect(store.getState().open).toEqual(["plugins-config"]);
    const empty = seeded({ state: { open: [] }, version: 1 });
    expect(empty.store.getState().open).toEqual([]);
  });

  it("F-204 ADR-0028: unknown ids are dropped and a bad shape or malformed JSON gives the defaults", () => {
    expect(
      seeded({
        state: { open: ["operators", "nope", 3] },
        version: 1,
      }).store.getState().open,
    ).toEqual(["operators"]);
    for (const bad of [
      { state: { open: "operators" }, version: 1 },
      { state: null, version: 1 },
      { state: {}, version: 1 },
      "{not json",
    ])
      expect(seeded(bad).store.getState().open).toEqual(DEFAULT_OPEN);
  });

  it("F-204 ADR-0028: a stored state from another version is replaced by the defaults", () => {
    for (const version of [0, 2])
      expect(
        seeded({ state: { open: ["factories"] }, version }).store.getState()
          .open,
      ).toEqual(DEFAULT_OPEN);
  });

  it("F-204 ADR-0028: storage that throws leaves the palette state working in memory", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    const store = createPaletteStore(() => ({
      getItem: boom,
      setItem: boom,
      removeItem: boom,
    }));
    store.getState().toggleCategory("factories");
    expect(store.getState().open).toContain("factories");
  });

  it("F-204 ADR-0028: the palette state never writes nf-builder:layout", () => {
    const { store, data } = fresh();
    store.getState().toggleCategory("factories");
    expect(data.has("nf-builder:layout")).toBe(false);
  });
});
