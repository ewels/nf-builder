// Loose files picked or dropped into a project (F-210, IO-12, QA-32): the same limits, text check and path rules as a zip,
// with the zip's result shape so `summarise` and `selectFiles` work unchanged. No ignore list: the user chose these files.
import type { ZipRead } from "../zip/read-zip.ts";
import { IMPORT_LIMITS, type ImportLimits } from "./limits.ts";
import { refuse } from "./messages.ts";
import { entryPath } from "./paths.ts";
import { byPath } from "./select.ts";
import { decodeText } from "./text.ts";
import type { ImportCandidate, ImportRefusal } from "./types.ts";

/** One chosen file; `bytes` is null when it wasn't read because it is over the text-file limit. */
export interface LooseEntry {
  readonly name: string;
  readonly size: number;
  readonly bytes: Uint8Array | null;
}

/** Refuses too many files or too many bytes, before anything is read. */
export function checkLooseFiles(
  count: number,
  totalBytes: number,
  limits: ImportLimits = IMPORT_LIMITS,
): ImportRefusal | null {
  if (count > limits.maxEntries) return refuse("too-many-files");
  if (totalBytes > limits.maxTotalBytes) return refuse("files-too-large");
  return null;
}

export function looseCandidates(
  entries: readonly LooseEntry[],
  limits: ImportLimits = IMPORT_LIMITS,
): ZipRead {
  const seen = new Set<string>();
  const candidates: ImportCandidate[] = entries.map((entry) => {
    const path = entryPath(entry.name);
    if (path.kind !== "file")
      return {
        path: entry.name,
        size: entry.size,
        text: null,
        reason: "unsafe-path",
      };
    if (seen.has(path.path))
      return {
        path: path.path,
        size: entry.size,
        text: null,
        reason: "duplicate",
      };
    seen.add(path.path);
    if (entry.size > limits.maxTextFileBytes)
      return {
        path: path.path,
        size: entry.size,
        text: null,
        reason: "too-large",
      };
    const text = entry.bytes === null ? null : decodeText(entry.bytes);
    return {
      path: path.path,
      size: entry.size,
      text,
      reason: text === null ? "binary" : null,
    };
  });
  candidates.sort(byPath);
  return { ok: true, entries: entries.length, stripped: null, candidates };
}
