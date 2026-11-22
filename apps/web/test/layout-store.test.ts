import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  COLUMN_LIMITS,
  createLayoutStore,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
} from "../src/layout/layout-store";

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
  return { ...m, store: createLayoutStore(() => m.storage) };
};
const seeded = (value: unknown) =>
  fresh({
    [LAYOUT_STORAGE_KEY]:
      typeof value === "string" ? value : JSON.stringify(value),
  });
const view = (s: { left: unknown; right: unknown }) => ({
  left: s.left,
  right: s.right,
});

describe("layout store", () => {
  it("UX-02: the left column defaults to 256 px and the right to 296 px, both expanded", () => {
    expect(DEFAULT_LAYOUT).toEqual({
      left: { width: 256, collapsed: false },
      right: { width: 296, collapsed: false },
    });
    expect(view(fresh().store.getState())).toEqual(DEFAULT_LAYOUT);
  });

  it("UX-02: setWidth clamps each column to its limits and rounds to whole pixels", () => {
    for (const side of ["left", "right"] as const) {
      const { store } = fresh();
      const { min, max } = COLUMN_LIMITS[side];
      store.getState().setWidth(side, min - 50);
      expect(store.getState()[side].width).toBe(min);
      store.getState().setWidth(side, max + 50);
      expect(store.getState()[side].width).toBe(max);
      store.getState().setWidth(side, 300.6);
      expect(store.getState()[side].width).toBe(301);
    }
  });

  it("UX-02: setWidth ignores widths that are not finite numbers", () => {
    const { store } = fresh();
    store.getState().setWidth("left", Number.NaN);
    store.getState().setWidth("left", Number.POSITIVE_INFINITY);
    expect(store.getState().left.width).toBe(256);
  });

  it("UX-02: collapsing keeps the width and expanding restores it", () => {
    const { store } = fresh();
    store.getState().setWidth("left", 320);
    store.getState().setCollapsed("left", true);
    expect(store.getState().left).toEqual({ width: 320, collapsed: true });
    store.getState().setCollapsed("left", false);
    expect(store.getState().left).toEqual({ width: 320, collapsed: false });
    store.getState().toggleCollapsed("right");
    expect(store.getState().right.collapsed).toBe(true);
    store.getState().toggleCollapsed("right");
    expect(store.getState().right.collapsed).toBe(false);
  });

  it("UX-02: resizing a collapsed column changes nothing", () => {
    const { store } = fresh();
    store.getState().setCollapsed("right", true);
    store.getState().setWidth("right", 400);
    expect(store.getState().right).toEqual({ width: 296, collapsed: true });
  });

  it("F-201 step 1 UX-02 AR-30: the layout is stored under nf-builder:layout as version 1 with widths and collapsed flags", () => {
    const { store, data } = fresh();
    store.getState().setWidth("left", 300);
    store.getState().setCollapsed("right", true);
    expect(LAYOUT_STORAGE_KEY).toBe("nf-builder:layout");
    expect(JSON.parse(data.get(LAYOUT_STORAGE_KEY) ?? "null")).toEqual({
      state: {
        left: { width: 300, collapsed: false },
        right: { width: 296, collapsed: true },
      },
      version: 1,
    });
  });

  it("F-201 step 1 UX-02: a new store starts from the stored layout (reload)", () => {
    const layout = {
      left: { width: 210, collapsed: true },
      right: { width: 400, collapsed: false },
    };
    const { store } = seeded({ state: layout, version: 1 });
    expect(view(store.getState())).toEqual(layout);
  });

  it("UX-02: malformed JSON, wrong types and out-of-range widths in storage fall back to defaults or are clamped, without throwing", () => {
    expect(view(seeded("{").store.getState())).toEqual(DEFAULT_LAYOUT);
    expect(
      view(seeded({ state: { left: "x" }, version: 1 }).store.getState()),
    ).toEqual(DEFAULT_LAYOUT);
    const s = seeded({
      state: {
        left: { width: 99999, collapsed: "yes" },
        right: { width: "wide", collapsed: true },
      },
      version: 1,
    }).store.getState();
    expect(s.left).toEqual({ width: COLUMN_LIMITS.left.max, collapsed: false });
    expect(s.right.collapsed).toBe(true);
    expect(s.right.width).toBe(296);
  });

  it("UX-02: a stored layout from another version is replaced by the defaults", () => {
    const state = {
      left: { width: 300, collapsed: true },
      right: { width: 300, collapsed: true },
    };
    for (const version of [0, 2]) {
      expect(view(seeded({ state, version }).store.getState())).toEqual(
        DEFAULT_LAYOUT,
      );
    }
  });

  it("UX-02: storage that throws (blocked or full) leaves the layout working in memory", () => {
    const blocked = createLayoutStore(() => {
      throw new Error("blocked");
    });
    blocked.getState().setWidth("left", 300);
    expect(blocked.getState().left.width).toBe(300);

    const full = createLayoutStore(() => ({
      getItem: () => {
        throw new Error("read");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("remove");
      },
    }));
    full.getState().setWidth("right", 320);
    full.getState().toggleCollapsed("left");
    expect(full.getState().right.width).toBe(320);
    expect(full.getState().left.collapsed).toBe(true);
  });
});
