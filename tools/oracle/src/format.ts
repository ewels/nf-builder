import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isRecord } from "./cases.ts";
import { type Evaluation, parseFormatJson } from "./check.ts";
import type { Exec, ExecResult } from "./nextflow.ts";
import { PRINTER_FIXTURES_FILE } from "./paths.ts";
import { type CheckResult, runCheck } from "./run.ts";

export const FORMAT_COMMAND = ["lint", "-format", "-o", "json", "."];

export type FormatFileKind = "parsed" | "support" | "synthesised" | "edited";
/** A tree of printer fixtures; the directories are absolute. `input` is null for a tree that only has printed files. */
export type FormatTree = {
  name: string;
  input: string | null;
  formatted: string;
  printed: string;
};
export type FormatFile = {
  tree: string;
  path: string;
  kind: FormatFileKind;
  knownDifference: string | null;
};
export type FormatManifest = {
  file: string;
  trees: FormatTree[];
  files: FormatFile[];
  knownDifferences: Record<string, string>;
};

const TOP_KEYS = new Set([
  "about",
  "upstream",
  "formattedWith",
  "trees",
  "knownDifferences",
  "files",
]);
const TREE_KEYS = new Set(["name", "input", "formatted", "printed"]);
const FILE_KEYS = new Set([
  "tree",
  "path",
  "kind",
  "knownDifference",
  "spec",
  "covers",
  "source",
  "adjusted",
]);
const KINDS: readonly string[] = ["parsed", "support", "synthesised", "edited"];

const unknownKeys = (raw: Record<string, unknown>, allowed: Set<string>) =>
  Object.keys(raw).filter((k) => !allowed.has(k));

/** Reads the printer fixtures manifest (`fixtures.json`). Directories resolve against the manifest's folder. Throws one Error listing every problem. */
export function loadFormatManifest(
  file: string = PRINTER_FIXTURES_FILE,
): FormatManifest {
  const root: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(root)) throw new Error(`${file}: must be an object`);
  const problems: string[] = [];
  const base = dirname(file);
  for (const key of unknownKeys(root, TOP_KEYS))
    problems.push(`${file}: unknown key "${key}"`);

  const knownDifferences: Record<string, string> = {};
  if (isRecord(root.knownDifferences)) {
    for (const [id, text] of Object.entries(root.knownDifferences)) {
      if (typeof text === "string") knownDifferences[id] = text;
      else problems.push(`${file}: knownDifferences.${id} must be a string`);
    }
  } else problems.push(`${file}: "knownDifferences" must be an object`);

  const trees: FormatTree[] = [];
  if (Array.isArray(root.trees)) {
    for (const entry of root.trees) {
      const raw = isRecord(entry) ? entry : {};
      const name = typeof raw.name === "string" ? raw.name : "";
      for (const key of unknownKeys(raw, TREE_KEYS))
        problems.push(`${file}: tree ${name || "?"}: unknown key "${key}"`);
      if (
        name === "" ||
        typeof raw.formatted !== "string" ||
        typeof raw.printed !== "string" ||
        (raw.input !== null && typeof raw.input !== "string")
      ) {
        problems.push(
          `${file}: tree ${name || "?"}: needs name, input (a path or null), formatted and printed`,
        );
        continue;
      }
      const input = raw.input === null ? null : resolve(base, raw.input);
      if (input !== null && !existsSync(input))
        problems.push(
          `${file}: tree ${name}: input directory ${input} is missing`,
        );
      trees.push({
        name,
        input,
        formatted: resolve(base, raw.formatted),
        printed: resolve(base, raw.printed),
      });
    }
  } else problems.push(`${file}: "trees" must be a list`);

  const files: FormatFile[] = [];
  if (Array.isArray(root.files)) {
    for (const entry of root.files) {
      const raw = isRecord(entry) ? entry : {};
      const path = typeof raw.path === "string" ? raw.path : "";
      const label = `${typeof raw.tree === "string" ? raw.tree : "?"}/${path || "?"}`;
      for (const key of unknownKeys(raw, FILE_KEYS))
        problems.push(`${file}: ${label}: unknown key "${key}"`);
      const tree = trees.find((t) => t.name === raw.tree);
      if (tree === undefined) {
        problems.push(`${file}: ${label}: unknown tree`);
        continue;
      }
      if (
        path === "" ||
        typeof raw.kind !== "string" ||
        !KINDS.includes(raw.kind)
      ) {
        problems.push(
          `${file}: ${label}: needs a path and a kind (${KINDS.join(", ")})`,
        );
        continue;
      }
      const kind = raw.kind as FormatFileKind;
      const knownDifference =
        typeof raw.knownDifference === "string" ? raw.knownDifference : null;
      if (raw.knownDifference !== undefined && knownDifference === null)
        problems.push(`${file}: ${label}: knownDifference must be a string`);
      if (knownDifference !== null && !(knownDifference in knownDifferences))
        problems.push(
          `${file}: ${label}: knownDifference "${knownDifference}" is not in knownDifferences`,
        );
      if (knownDifference !== null && kind !== "parsed")
        problems.push(
          `${file}: ${label}: only a parsed file can have a knownDifference`,
        );
      if (
        (kind === "parsed" || kind === "support") &&
        (tree.input === null || !existsSync(join(tree.input, path)))
      )
        problems.push(`${file}: ${label}: a ${kind} file needs an input file`);
      files.push({ tree: tree.name, path, kind, knownDifference });
    }
  } else problems.push(`${file}: "files" must be a list`);

  if (problems.length > 0) throw new Error(problems.join("\n"));
  return { file, trees, files, knownDifferences };
}

export type FormatRunOptions = {
  exec: Exec;
  /** The directory the trees are copied to: `<formatDir>/<tree>/input` and `<formatDir>/<tree>/expected`. */
  formatDir: string;
  /** Write `formatted/` from Nextflow's output instead of comparing with it (only the `format` check runs). */
  write?: boolean;
  log?: (line: string) => void;
};

/** Relative paths (with "/") of every file under dir, sorted. [] if dir doesn't exist. */
function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

const isScript = (path: string): boolean => path.endsWith(".nf");

/** The first line where the texts differ, and a unified diff of the lines between the common prefix and suffix. */
function diffOf(
  path: string,
  expected: string,
  actual: string,
): { first: number; diff: string } {
  const a = expected.split("\n");
  const b = actual.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const removed = a.slice(head, a.length - tail);
  const added = b.slice(head, b.length - tail);
  const diff = [
    `--- expected/${path}`,
    `+++ actual/${path}`,
    `@@ -${head + 1},${removed.length} +${head + 1},${added.length} @@`,
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ].join("\n");
  return { first: head + 1, diff };
}

type Compare = { problems: string[]; diffs: string[] };

/** Compares each expected file with the file the run left at `dir/<path>`. */
function compareFiles(
  dir: string,
  expected: ReadonlyMap<string, string>,
  what: string,
): Compare {
  const problems: string[] = [];
  const diffs: string[] = [];
  for (const [path, text] of expected) {
    const file = join(dir, path);
    const actual = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (actual === null) {
      problems.push(`${path}: missing after the run`);
    } else if (actual !== text) {
      const { first, diff } = diffOf(path, text, actual);
      problems.push(`${path}: ${what}; first difference at line ${first}`);
      diffs.push(diff);
    }
  }
  return { problems, diffs };
}

function lintProblems(
  result: ExecResult,
  report: ReturnType<typeof parseFormatJson>,
): string[] {
  const problems: string[] = [];
  if (report === null) {
    problems.push("no JSON report in the lint -format output");
    return problems;
  }
  if (result.status !== 0 || report.errors.length > 0) {
    const quote = report.errors
      .slice(0, 3)
      .map(
        (e) => `${e.filename}:${e.startLine}:${e.startColumn} "${e.message}"`,
      )
      .join(", ");
    problems.push(
      `lint -format exit ${result.status ?? result.signal}, ${report.errors.length} error(s)${quote ? `; first: ${quote}` : ""}`,
    );
  }
  return problems;
}

/**
 * Two checks per tree that has an input (`printer:<tree>` rows):
 * - `format`: lint -format on a copy of `input/` must exit 0 with no errors, and every script must then equal
 *   `formatted/<path>` (with `write`, `formatted/` is written from the result instead);
 * - `fixed-point`: lint -format on `expected/` (the input tree with `formatted/` then `printed/` laid over it) must exit 0
 *   with no errors, format nothing and leave every script unchanged, except the scripts the manifest gives a known
 *   difference, which lint -format may rewrite (at most that many files formatted).
 */
export function runFormatTrees(
  manifest: FormatManifest,
  options: FormatRunOptions,
): CheckResult[] {
  const { exec, formatDir, write = false, log = () => {} } = options;
  const results: CheckResult[] = [];

  const check = (
    tree: FormatTree,
    dir: string,
    kind: "format" | "fixed-point",
    evaluate: (report: ReturnType<typeof parseFormatJson>) => Compare,
  ): CheckResult => {
    log(`printer:${tree.name}: nextflow ${FORMAT_COMMAND.join(" ")} (${kind})`);
    let diffs: string[] = [];
    const row = runCheck(
      exec,
      dir,
      `printer:${tree.name}`,
      kind,
      FORMAT_COMMAND,
      "ok",
      (result): Evaluation => {
        const report = parseFormatJson(result.stdout);
        const failed = lintProblems(result, report);
        const compared = failed.length === 0 ? evaluate(report) : null;
        diffs = compared?.diffs ?? [];
        const problems = compared ? compared.problems : failed;
        return {
          actual: failed.length === 0 ? "ok" : "error",
          matched: problems.length === 0,
          problems,
          errors: report?.errors.map((e) => e.message) ?? [],
          warnings: [],
        };
      },
    );
    if (diffs.length > 0) {
      appendFileSync(row.logFile, `--- diff ---\n${diffs.join("\n")}\n`);
    }
    return row;
  };

  for (const tree of manifest.trees) {
    if (tree.input === null) continue;
    const root = join(formatDir, tree.name);
    rmSync(root, { recursive: true, force: true });

    const inputDir = join(root, "input");
    mkdirSync(root, { recursive: true });
    cpSync(tree.input, inputDir, { recursive: true });
    const scripts = listFiles(tree.input).filter(isScript);
    results.push(
      check(tree, inputDir, "format", () => {
        if (write) {
          rmSync(tree.formatted, { recursive: true, force: true });
          for (const path of scripts) {
            const target = join(tree.formatted, path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, readFileSync(join(inputDir, path)));
          }
          return { problems: [], diffs: [] };
        }
        const expected = new Map<string, string>();
        const missing: string[] = [];
        for (const path of scripts) {
          const golden = join(tree.formatted, path);
          if (existsSync(golden))
            expected.set(path, readFileSync(golden, "utf8"));
          else missing.push(`${path}: formatted/${path} is missing`);
        }
        const compared = compareFiles(
          inputDir,
          expected,
          "lint -format output differs from formatted/",
        );
        return {
          problems: [...missing, ...compared.problems],
          diffs: compared.diffs,
        };
      }),
    );
    if (write) continue;

    const expectedDir = join(root, "expected");
    cpSync(tree.input, expectedDir, { recursive: true });
    for (const overlay of [tree.formatted, tree.printed]) {
      for (const path of listFiles(overlay)) {
        const target = join(expectedDir, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(overlay, path)));
      }
    }
    // A file with a known difference is one lint -format would write differently (that is the difference), so it may
    // change here; it must still lint clean. Every other script must stay as it is.
    const exempt = new Set(
      manifest.files
        .filter((f) => f.tree === tree.name && f.knownDifference !== null)
        .map((f) => f.path),
    );
    const before = new Map<string, string>();
    for (const path of listFiles(expectedDir).filter(isScript))
      if (!exempt.has(path))
        before.set(path, readFileSync(join(expectedDir, path), "utf8"));
    results.push(
      check(tree, expectedDir, "fixed-point", (report) => {
        const compared = compareFiles(
          expectedDir,
          before,
          "lint -format changed the file",
        );
        const problems = [...compared.problems];
        if (report !== null && report.summary.filesFormatted > exempt.size)
          problems.push(
            `lint -format reports ${report.summary.filesFormatted} file(s) formatted, expected ${exempt.size === 0 ? "0" : `at most ${exempt.size}`}`,
          );
        return { problems, diffs: compared.diffs };
      }),
    );
  }
  return results;
}
