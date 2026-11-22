import { COLUMN_LIMITS, type Side } from "./layout-store";

export const KEYBOARD_STEP = 16;

export type SeparatorAction =
  | { readonly type: "resize"; readonly width: number }
  | { readonly type: "collapse" };

/** WAI-ARIA window splitter. Width is unclamped; the store clamps. */
export function separatorKeyAction(
  side: Side,
  key: string,
  width: number,
): SeparatorAction | undefined {
  const widen = side === "left" ? "ArrowRight" : "ArrowLeft";
  const narrow = side === "left" ? "ArrowLeft" : "ArrowRight";
  switch (key) {
    case widen:
      return { type: "resize", width: width + KEYBOARD_STEP };
    case narrow:
      return { type: "resize", width: width - KEYBOARD_STEP };
    case "Home":
      return { type: "resize", width: COLUMN_LIMITS[side].min };
    case "End":
      return { type: "resize", width: COLUMN_LIMITS[side].max };
    case "Enter":
      return { type: "collapse" };
    default:
      return undefined;
  }
}

/** Left: startWidth + (x - startX); right: startWidth - (x - startX). Unclamped. */
export function dragWidth(
  side: Side,
  startWidth: number,
  startX: number,
  x: number,
): number {
  return side === "left"
    ? startWidth + (x - startX)
    : startWidth - (x - startX);
}
