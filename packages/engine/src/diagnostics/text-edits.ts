import type { TextEdit } from "@nf-builder/lang-core";

/**
 * Applies edits to the text they were made against. Edits may come in any order; they must lie inside the text and
 * must not overlap (touching is fine). Throws a `RangeError` otherwise.
 */
export function applyTextEdits(
  text: string,
  edits: readonly TextEdit[],
): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const e of sorted) {
    if (e.start < 0 || e.end < e.start || e.end > text.length)
      throw new RangeError(
        `Text edit ${e.start}-${e.end} is outside the text (length ${text.length})`,
      );
    if (e.start < at)
      throw new RangeError(
        `Text edit ${e.start}-${e.end} overlaps an earlier edit`,
      );
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}
