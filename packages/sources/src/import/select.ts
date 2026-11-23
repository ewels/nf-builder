import { type IgnoreList, isIgnored, parseIgnore } from "./ignore.ts";
import type {
  ImportCandidate,
  ImportedFile,
  ImportSummary,
  SkipGroup,
  SkipReason,
} from "./types.ts";

const SKIP_ORDER: readonly SkipReason[] = [
  "ignored",
  "too-large",
  "binary",
  "unsafe-path",
  "duplicate",
  "unsupported",
];
const SKIP_LIST_MAX = 100;

export const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Why a candidate is left out, or null when it is imported. */
function skipReason(c: ImportCandidate, list: IgnoreList): SkipReason | null {
  if (c.reason === "unsafe-path" || c.reason === "duplicate") return c.reason;
  if (isIgnored(list, c.path)) return "ignored";
  if (c.reason !== null) return c.reason;
  return c.text === null ? "binary" : null;
}

export function selectFiles(
  candidates: readonly ImportCandidate[],
  list: IgnoreList,
): readonly ImportedFile[] {
  const files: ImportedFile[] = [];
  for (const c of candidates) {
    if (c.text !== null && skipReason(c, list) === null)
      files.push({ path: c.path, text: c.text });
  }
  return files.sort(byPath);
}

export function summarise(input: {
  source: string;
  stripped: string | null;
  candidates: readonly ImportCandidate[];
  ignore: string;
}): ImportSummary {
  const list = parseIgnore(input.ignore);
  let files = 0;
  let bytes = 0;
  const groups = new Map<SkipReason, ImportCandidate[]>();
  for (const c of input.candidates) {
    const reason = skipReason(c, list);
    if (reason === null) {
      files += 1;
      bytes += c.size;
    } else {
      const group = groups.get(reason);
      if (group === undefined) groups.set(reason, [c]);
      else group.push(c);
    }
  }
  const skipped: SkipGroup[] = [];
  for (const reason of SKIP_ORDER) {
    const members = groups.get(reason);
    if (members === undefined) continue;
    skipped.push({
      reason,
      count: members.length,
      bytes: members.reduce((sum, c) => sum + c.size, 0),
      paths: members
        .map((c) => c.path)
        .sort()
        .slice(0, SKIP_LIST_MAX),
    });
  }
  return {
    source: input.source,
    stripped: input.stripped,
    files,
    bytes,
    skipped,
    ignore: input.ignore,
    ignoreProblems: list.problems,
  };
}

/** The message that blocks Create, or null. */
export function importProblem(summary: ImportSummary): string | null {
  const first = summary.ignoreProblems[0];
  if (first !== undefined)
    return `Fix the ignore list first. Line ${first.line}: ${first.message}`;
  if (summary.files === 0) return "Nothing to import: every file was skipped.";
  return null;
}
