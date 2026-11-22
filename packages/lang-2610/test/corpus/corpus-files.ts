// Pure helpers for the corpus parse test (parse.corpus.ts): which files nextflow lint checks, and how parser and
// lint outcomes are compared. Unit-tested in pnpm check; the corpus itself is read only under pnpm test:corpus.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** nextflow lint's default excludes (26.10): directory or file names at any depth. */
export const LINT_EXCLUDES: readonly string[] = [
  ".git",
  ".lineage",
  ".nextflow",
  ".nf-test",
  "nf-test.config",
  "work",
];

export type SourceFile = { path: string; kind: "script" | "config" };

/** `*.nf` are scripts and `*.config` are configs; sorted, relative POSIX paths. */
export function listSources(dir: string): SourceFile[] {
  const found: SourceFile[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(dir, relative), {
      withFileTypes: true,
    })) {
      if (LINT_EXCLUDES.includes(entry.name)) continue;
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".nf")) found.push({ path, kind: "script" });
      else if (entry.name.endsWith(".config"))
        found.push({ path, kind: "config" });
    }
  };
  walk("");
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

type Outcome = "error" | "ok";
export type KnownDifference = {
  pipeline: string;
  file: string;
  lint: Outcome;
  parser: Outcome;
  cause: string;
};
export type FileOutcome = { pipeline: string; file: string; parser: Outcome };
export type Diff = Omit<KnownDifference, "cause">;

const isOutcome = (v: unknown): v is Outcome => v === "error" || v === "ok";

export function loadKnownDifferences(file: string): KnownDifference[] {
  const json: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(json)) throw new Error(`${file}: must be a JSON array`);
  return json.map((row: unknown, i) => {
    const r = (typeof row === "object" && row !== null ? row : {}) as Record<
      string,
      unknown
    >;
    const where = `${file}[${i}]`;
    for (const key of ["pipeline", "file"] as const)
      if (typeof r[key] !== "string" || r[key] === "")
        throw new Error(`${where}: "${key}" must be a non-empty string`);
    if (!isOutcome(r.lint))
      throw new Error(`${where}: "lint" must be "error" or "ok"`);
    if (!isOutcome(r.parser))
      throw new Error(`${where}: "parser" must be "error" or "ok"`);
    if (r.lint === r.parser)
      throw new Error(
        `${where}: lint and parser agree, so this is not a difference`,
      );
    if (typeof r.cause !== "string" || r.cause.trim() === "")
      throw new Error(`${where}: every difference needs a non-empty "cause"`);
    return r as unknown as KnownDifference;
  });
}

/**
 * A difference is a file that lint and the parser judge differently. `lint` maps a pipeline to the files lint reported
 * errors for. Listed differences have a known cause; stale rows are listed differences that no longer occur.
 */
export function compare(
  outcomes: readonly FileOutcome[],
  lint: ReadonlyMap<string, ReadonlySet<string>>,
  known: readonly KnownDifference[],
): { unexpected: Diff[]; stale: KnownDifference[]; listed: Diff[] } {
  const unexpected: Diff[] = [];
  const listed: Diff[] = [];
  const seen = new Set<KnownDifference>();
  for (const o of outcomes) {
    const lintOutcome: Outcome = lint.get(o.pipeline)?.has(o.file)
      ? "error"
      : "ok";
    if (lintOutcome === o.parser) continue;
    const diff: Diff = {
      pipeline: o.pipeline,
      file: o.file,
      lint: lintOutcome,
      parser: o.parser,
    };
    const row = known.find(
      (k) =>
        k.pipeline === diff.pipeline &&
        k.file === diff.file &&
        k.lint === diff.lint &&
        k.parser === diff.parser,
    );
    if (row) {
      seen.add(row);
      listed.push(diff);
    } else unexpected.push(diff);
  }
  return { unexpected, stale: known.filter((k) => !seen.has(k)), listed };
}
