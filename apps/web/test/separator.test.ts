import { describe, expect, it } from "vitest";
import { COLUMN_LIMITS } from "../src/layout/layout-store";
import {
  dragWidth,
  KEYBOARD_STEP,
  separatorKeyAction,
} from "../src/layout/separator";

describe("separator", () => {
  it("UX-02 UX-70: on the left separator ArrowRight widens and ArrowLeft narrows by 16 px", () => {
    expect(KEYBOARD_STEP).toBe(16);
    expect(separatorKeyAction("left", "ArrowRight", 256)).toEqual({
      type: "resize",
      width: 272,
    });
    expect(separatorKeyAction("left", "ArrowLeft", 256)).toEqual({
      type: "resize",
      width: 240,
    });
  });

  it("UX-02 UX-70: on the right separator ArrowLeft widens and ArrowRight narrows by 16 px", () => {
    expect(separatorKeyAction("right", "ArrowLeft", 296)).toEqual({
      type: "resize",
      width: 312,
    });
    expect(separatorKeyAction("right", "ArrowRight", 296)).toEqual({
      type: "resize",
      width: 280,
    });
  });

  it("UX-02 UX-70: Home and End go to the column's minimum and maximum, Enter collapses, other keys do nothing", () => {
    for (const side of ["left", "right"] as const) {
      expect(separatorKeyAction(side, "Home", 300)).toEqual({
        type: "resize",
        width: COLUMN_LIMITS[side].min,
      });
      expect(separatorKeyAction(side, "End", 300)).toEqual({
        type: "resize",
        width: COLUMN_LIMITS[side].max,
      });
      expect(separatorKeyAction(side, "Enter", 300)).toEqual({
        type: "collapse",
      });
      expect(separatorKeyAction(side, "a", 300)).toBeUndefined();
      expect(separatorKeyAction(side, "Tab", 300)).toBeUndefined();
    }
  });

  it("UX-02: dragging the left separator right widens the left column; dragging the right separator left widens the right column", () => {
    expect(dragWidth("left", 256, 100, 200)).toBe(356);
    expect(dragWidth("left", 256, 100, 50)).toBe(206);
    expect(dragWidth("right", 296, 1000, 940)).toBe(356);
    expect(dragWidth("right", 296, 1000, 1050)).toBe(246);
  });
});
