import { binaryByName } from "./binary.ts";
import { parseIgnore } from "./ignore.ts";
import { IMPORT_LIMITS } from "./limits.ts";
import { entryPath } from "./paths.ts";
import { selectFiles, summarise } from "./select.ts";
import type {
  FixedSkipReason,
  ImportCandidate,
  ImportSummary,
} from "./types.ts";

/** An entry of a listing, before any content is downloaded (F-401). */
export interface PlanCandidate {
  readonly path: string;
  readonly size: number | null;
  readonly kind: "file" | "symlink" | "submodule";
}

export interface PlannedFile {
  readonly path: string;
  readonly size: number;
}

export interface LimitBreach {
  readonly limit: "files" | "total-bytes";
  readonly actual: number;
  readonly max: number;
}

export interface ImportPlan {
  readonly files: readonly PlannedFile[];
  readonly summary: ImportSummary;
  readonly breaches: readonly LimitBreach[];
  readonly hasNextflow: boolean;
}

function reasonOf(c: PlanCandidate): FixedSkipReason | null {
  const path = entryPath(c.path);
  if (path.kind === "unsafe") return "unsafe-path";
  if (c.kind !== "file") return "unsupported";
  if (binaryByName(c.path)) return "binary";
  if ((c.size ?? 0) > IMPORT_LIMITS.maxTextFileBytes) return "too-large";
  return null;
}

/**
 * What to download from a listing: the same skip rules and ignore list as the zip route, decided by name and size.
 * Content checks (NUL, invalid UTF-8) come after download. `text: ""` marks "not downloaded yet" for selection.
 */
export function planImport(
  candidates: readonly PlanCandidate[],
  ignore: string,
  source = "",
): ImportPlan {
  const mapped: ImportCandidate[] = candidates.map((c) => {
    const reason = reasonOf(c);
    return {
      path: c.path,
      size: c.size ?? 0,
      text: reason === null ? "" : null,
      reason,
    };
  });
  const list = summarise({
    source,
    stripped: null,
    candidates: mapped,
    ignore,
  });
  const sizes = new Map(mapped.map((c) => [c.path, c.size]));
  const files = selectFiles(mapped, parseIgnore(ignore)).map((f) => ({
    path: f.path,
    size: sizes.get(f.path) ?? 0,
  }));
  const breaches: LimitBreach[] = [];
  if (list.files > IMPORT_LIMITS.maxEntries)
    breaches.push({
      limit: "files",
      actual: list.files,
      max: IMPORT_LIMITS.maxEntries,
    });
  if (list.bytes > IMPORT_LIMITS.maxTotalBytes)
    breaches.push({
      limit: "total-bytes",
      actual: list.bytes,
      max: IMPORT_LIMITS.maxTotalBytes,
    });
  return {
    files,
    summary: list,
    breaches,
    hasNextflow: files.some((f) => f.path.endsWith(".nf")),
  };
}
