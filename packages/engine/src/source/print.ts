import type { SourceFile } from "@nf-builder/lang-core";
import { topLevelItems } from "./items";

/**
 * The text of a file: each item from its source slice (an `Unparsed` from its kept text) and the text between items as
 * it was, so an unedited file prints back byte for byte (IO-20, ADR 0004). Throws if the items are not sorted and in
 * bounds; `createSourceFile` guarantees they are.
 */
export function printSourceFile(file: SourceFile): string {
  if (file.ast === null) return file.text;
  const { text } = file;
  const parts: string[] = [];
  let at = 0;
  for (const item of topLevelItems(file)) {
    const { start, end } = item.range;
    if (start < at || end < start || end > text.length)
      throw new Error(
        `Item at ${start}-${end} is out of order or out of bounds`,
      );
    parts.push(text.slice(at, start));
    parts.push(item.kind === "Unparsed" ? item.text : text.slice(start, end));
    at = end;
  }
  parts.push(text.slice(at));
  return parts.join("");
}
