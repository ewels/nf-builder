import type { SelectorMatch } from "@nf-builder/engine";

/** How many processes a selector matches (F-601, FI-06). */
export function selectorUse(match: SelectorMatch): string {
  if (match.count === null) return "Can't evaluate this pattern";
  if (match.count === 0) return "used by no process";
  return `used by ${match.count} ${match.count === 1 ? "process" : "processes"}`;
}
