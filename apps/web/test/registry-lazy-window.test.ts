import { describe, expect, it } from "vitest";
import {
  nextLimit,
  REGISTRY_PAGE,
  windowOf,
} from "../src/registry/lazy-window";

describe("registry lazy window", () => {
  it("F-503 step 2 UX-14: nextLimit grows by one page and stops at total", () => {
    expect(REGISTRY_PAGE).toBe(100);
    expect(nextLimit(100, 2296)).toBe(200);
    expect(nextLimit(200, 250)).toBe(250);
    expect(nextLimit(250, 250)).toBe(250);
    expect(nextLimit(10, 1000, 5)).toBe(15);
  });

  it("F-503 step 2 UX-14: windowOf returns the first limit rows and the remaining count", () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    const w = windowOf(rows, 100);
    expect(w.shown).toHaveLength(100);
    expect(w.shown[99]).toBe(99);
    expect(w.remaining).toBe(150);
    expect(windowOf(rows, 400)).toEqual({ shown: rows, remaining: 0 });
  });
});
