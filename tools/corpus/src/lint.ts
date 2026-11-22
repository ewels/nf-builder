// Runs `nextflow lint -o json` over the pinned corpus and the malformed fixtures, and caches the results per pin and
// Nextflow version (F-006, ADR 0005, ADR 0003: standalone, no workspace imports). The Nextflow version is never named here:
// it comes from the launcher, which is the pinned dist in .cache/nextflow/ unless told otherwise.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "./manifest.ts";
import { REPO_ROOT } from "./manifest.ts";

type LintError = {
  filename: string;
  startLine: number;
  startColumn: number;
  message: string;
};
export type LintResult = {
  id: string;
  sha: string;
  nextflowVersion: string;
  filesChecked: number;
  errors: LintError[];
};

const LINT_CACHE_DIR = `${REPO_ROOT}.cache/corpus-lint`;
const UPSTREAM_FILE = `${REPO_ROOT}packages/lang-2610/upstream.json`;

const COMMENT_DUMP_JAVA = fileURLToPath(
  new URL("CommentDump.java", import.meta.url),
);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** filesChecked = filesWithErrors + filesWithoutErrors. */
export function parseLintJson(stdout: string): {
  filesChecked: number;
  errors: LintError[];
} {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error(
      `nextflow lint output is not JSON: ${stdout.slice(0, 200)}`,
    );
  }
  if (!isRecord(json) || !isRecord(json.summary) || !Array.isArray(json.errors))
    throw new Error("nextflow lint output has no summary and errors");
  const { filesWithErrors, filesWithoutErrors } = json.summary;
  if (
    typeof filesWithErrors !== "number" ||
    typeof filesWithoutErrors !== "number"
  )
    throw new Error("nextflow lint summary has no file counts");
  const errors = json.errors.map((e: unknown) => {
    if (
      !isRecord(e) ||
      typeof e.filename !== "string" ||
      typeof e.startLine !== "number" ||
      typeof e.startColumn !== "number" ||
      typeof e.message !== "string"
    )
      throw new Error(`unexpected lint error entry: ${JSON.stringify(e)}`);
    return {
      filename: e.filename,
      startLine: e.startLine,
      startColumn: e.startColumn,
      message: e.message,
    };
  });
  return { filesChecked: filesWithErrors + filesWithoutErrors, errors };
}

/** The JSON `nextflow lint -format -o json` prints: the lint summary and errors, and how many files it rewrote. */
export function parseFormatJson(stdout: string): {
  filesChecked: number;
  filesFormatted: number;
  errors: LintError[];
} {
  const lint = parseLintJson(stdout);
  const summary = (JSON.parse(stdout) as { summary: Record<string, unknown> })
    .summary;
  if (typeof summary.filesFormatted !== "number")
    throw new Error("nextflow lint -format summary has no filesFormatted");
  return { ...lint, filesFormatted: summary.filesFormatted };
}

/** The file written to `.cache/corpus-lint/<id>.format.json`; the formatted tree is `.cache/corpus-lint/<id>.format/`. */
export type FormatResult = {
  id: string;
  sha: string;
  nextflowVersion: string;
  filesChecked: number;
  filesFormatted: number;
  errors: LintError[];
};

/**
 * Formats a copy of `dir` (never `dir` itself: `-format` rewrites files in place, and `.git` is left out) into `outDir`
 * with `nextflow lint -format -o json .`. Nextflow formats only the files that lint without errors, so those are the files
 * a printer must reproduce. Exit 0 or 1 with parseable JSON is a result.
 */
export function formatDir(
  launcher: string,
  dir: string,
  outDir: string,
): { filesChecked: number; filesFormatted: number; errors: LintError[] } {
  rmSync(outDir, { recursive: true, force: true });
  cpSync(dir, outDir, {
    recursive: true,
    filter: (source) => basename(source) !== ".git",
  });
  const run = spawnSync(launcher, ["lint", "-format", "-o", "json", "."], {
    cwd: outDir,
    encoding: "utf8",
    env: lintEnv(),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error)
    throw new Error(`could not run ${launcher}: ${run.error.message}`);
  if (run.status === 0 || run.status === 1) {
    try {
      return parseFormatJson(run.stdout);
    } catch (error) {
      throw new Error(
        `${(error as Error).message}\nstderr tail:\n${tail(run.stderr)}`,
      );
    }
  }
  throw new Error(
    `nextflow lint -format exited with ${run.status} in ${outDir}\nstderr tail:\n${tail(run.stderr)}`,
  );
}

export type CommentRow = {
  line: number;
  column: number;
  text: string;
  slot: "leading" | "trailing" | "dangling";
  node: {
    class: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
  };
};
/** `comments` is what nf-lang's CommentAttacher attached; `error` is why the builder rejected the file. */
export type CommentDumpFile =
  | { file: string; comments: CommentRow[] }
  | { file: string; error: string };
export type CommentDump = { files: CommentDumpFile[] };
/** The file written to `.cache/corpus-lint/<id>.comments.json`. */
export type CommentDumpResult = CommentDump & {
  id: string;
  sha: string;
  nextflowVersion: string;
};

const SLOTS = ["leading", "trailing", "dangling"];
const isNumber = (v: unknown): v is number => typeof v === "number";

function parseCommentRow(value: unknown): CommentRow {
  if (
    !isRecord(value) ||
    !isNumber(value.line) ||
    !isNumber(value.column) ||
    typeof value.text !== "string" ||
    typeof value.slot !== "string" ||
    !SLOTS.includes(value.slot) ||
    !isRecord(value.node) ||
    typeof value.node.class !== "string" ||
    !isNumber(value.node.line) ||
    !isNumber(value.node.column) ||
    !isNumber(value.node.endLine) ||
    !isNumber(value.node.endColumn)
  )
    throw new Error(`unexpected comment entry: ${JSON.stringify(value)}`);
  return value as CommentRow;
}

/** Reads what CommentDump.java prints: one JSON document, possibly after JVM notices on earlier lines. */
export function parseCommentDump(stdout: string): CommentDump {
  const start = stdout.indexOf('{"files":');
  let json: unknown;
  try {
    json = JSON.parse(start < 0 ? stdout : stdout.slice(start));
  } catch {
    throw new Error(`CommentDump output is not JSON: ${stdout.slice(0, 200)}`);
  }
  if (!isRecord(json) || !Array.isArray(json.files))
    throw new Error("CommentDump output has no files list");
  const files = json.files.map((f: unknown): CommentDumpFile => {
    if (!isRecord(f) || typeof f.file !== "string")
      throw new Error(
        `unexpected CommentDump file entry: ${JSON.stringify(f)}`,
      );
    if (typeof f.error === "string") return { file: f.file, error: f.error };
    if (!Array.isArray(f.comments))
      throw new Error(`${f.file}: CommentDump entry has no comments or error`);
    return { file: f.file, comments: f.comments.map(parseCommentRow) };
  });
  return { files };
}

/** Runs CommentDump.java against the dist's classes: the comments nf-lang attaches in every `.nf` file under `dir`. */
export function dumpComments(launcher: string, dir: string): CommentDump {
  const run = spawnSync("java", ["-cp", launcher, COMMENT_DUMP_JAVA, dir], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (run.error)
    throw new Error(
      (run.error as NodeJS.ErrnoException).code === "ENOENT"
        ? "java not found: install a JDK 17+ (java on PATH)"
        : `could not run java: ${run.error.message}`,
    );
  if (run.status !== 0)
    throw new Error(
      `CommentDump.java failed (exit ${run.status}) in ${dir}\nstderr tail:\n${tail(run.stderr)}`,
    );
  return parseCommentDump(run.stdout);
}

/** Same environment as the CI oracle; an inherited NXF_VER would make Nextflow download another version. */
function lintEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NXF_HOME: `${REPO_ROOT}.cache/nextflow/home`,
    NXF_OFFLINE: "true",
    NXF_DISABLE_CHECK_LATEST: "true",
    NXF_ANSI_LOG: "false",
    NXF_SYNTAX_PARSER: "v2",
  };
  delete env.NXF_VER;
  return env;
}

/** "nextflow-26.10.7-dist" names its version, so no Java is started; any other launcher is asked with `-version`. */
export function nextflowVersion(launcher: string): string {
  const named = /^nextflow-(\d+\.\d+\.\d+\S*?)-dist$/.exec(basename(launcher));
  if (named?.[1]) return named[1];
  const run = spawnSync(launcher, ["-version"], {
    encoding: "utf8",
    env: lintEnv(),
  });
  const found = /version (\d+\.\d+\.\d+\S*)/.exec(`${run.stdout}${run.stderr}`);
  if (!found?.[1])
    throw new Error(
      `could not read the Nextflow version from \`${launcher} -version\`${run.error ? `: ${run.error.message}` : ""}`,
    );
  return found[1];
}

const tail = (text: string): string =>
  text.trim().split("\n").slice(-15).join("\n");

/** Exit 0 or 1 with parseable JSON is a result; anything else is an Error with the stderr tail. */
export function lintDir(
  launcher: string,
  dir: string,
): { filesChecked: number; errors: LintError[] } {
  const run = spawnSync(launcher, ["lint", "-o", "json", "."], {
    cwd: dir,
    encoding: "utf8",
    env: lintEnv(),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error)
    throw new Error(`could not run ${launcher}: ${run.error.message}`);
  if (run.status === 0 || run.status === 1) {
    try {
      return parseLintJson(run.stdout);
    } catch (error) {
      throw new Error(
        `${(error as Error).message}\nstderr tail:\n${tail(run.stderr)}`,
      );
    }
  }
  throw new Error(
    `nextflow lint exited with ${run.status} in ${dir}\nstderr tail:\n${tail(run.stderr)}`,
  );
}

export function isCached(file: string, sha: string, version: string): boolean {
  try {
    const cached: unknown = JSON.parse(readFileSync(file, "utf8"));
    return (
      isRecord(cached) &&
      cached.sha === sha &&
      cached.nextflowVersion === version
    );
  } catch {
    return false;
  }
}

/** The launcher is the flag, else NXF_LAUNCHER, else the pinned dist at .cache/nextflow/<version>/nextflow-<version>-dist. */
export function resolveLauncher(o: {
  flag?: string;
  env: Record<string, string | undefined>;
  upstreamFile?: string;
  repoRoot?: string;
}): { path: string } {
  if (o.flag) return { path: o.flag };
  if (o.env.NXF_LAUNCHER) return { path: o.env.NXF_LAUNCHER };
  const upstream: unknown = JSON.parse(
    readFileSync(o.upstreamFile ?? UPSTREAM_FILE, "utf8"),
  );
  const nextflow = isRecord(upstream) ? upstream.nextflow : undefined;
  const version = isRecord(nextflow) ? nextflow.version : undefined;
  if (typeof version !== "string")
    throw new Error(
      `${o.upstreamFile ?? UPSTREAM_FILE} has no nextflow.version`,
    );
  return {
    path: join(
      o.repoRoot ?? REPO_ROOT,
      ".cache/nextflow",
      version,
      `nextflow-${version}-dist`,
    ),
  };
}

/** SHA-256 over the sorted fixture files' names and bytes. */
function fixturesSha(fixturesDir: string): string {
  const hash = createHash("sha256");
  for (const name of readdirSync(fixturesDir).sort()) {
    hash.update(`${name}\0`);
    hash.update(readFileSync(join(fixturesDir, name)));
  }
  return hash.digest("hex");
}

/** One result per pipeline plus "fixtures", written to .cache/corpus-lint/<id>.json. */
export function lintCorpus(o: {
  launcher: string;
  manifest: Manifest;
  cacheDir: string;
  fixturesDir: string;
  force?: boolean;
  log: (line: string) => void;
}): LintResult[] {
  const version = nextflowVersion(o.launcher);
  const targets = [
    ...o.manifest.pipelines.map((p) => ({
      id: p.id,
      sha: p.sha,
      dir: join(o.cacheDir, p.id),
    })),
    { id: "fixtures", sha: fixturesSha(o.fixturesDir), dir: o.fixturesDir },
  ];
  mkdirSync(LINT_CACHE_DIR, { recursive: true });
  // CommentDump.java needs the classes of the dist; any other launcher is not a jar it can use
  const commentsFor = /^nextflow-.+-dist$/.test(basename(o.launcher));
  const results: LintResult[] = [];
  for (const t of targets) {
    const file = join(LINT_CACHE_DIR, `${t.id}.json`);
    const commentsFile = join(LINT_CACHE_DIR, `${t.id}.comments.json`);
    // only the pinned pipelines are formatted: the fixtures are malformed on purpose
    const formatTarget = t.id !== "fixtures";
    const commentsCached =
      !commentsFor || (!o.force && isCached(commentsFile, t.sha, version));
    if (!o.force && isCached(file, t.sha, version)) {
      results.push(JSON.parse(readFileSync(file, "utf8")) as LintResult);
      o.log(`corpus-lint: ${t.id} up to date`);
      if (!commentsCached)
        writeComments(o.launcher, t, version, commentsFile, o.log);
      if (formatTarget) writeFormat(o.launcher, t, version, o.force, o.log);
      continue;
    }
    const started = Date.now();
    const lint = lintDir(o.launcher, t.dir);
    const result: LintResult = {
      id: t.id,
      sha: t.sha,
      nextflowVersion: version,
      ...lint,
    };
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    results.push(result);
    o.log(
      `corpus-lint: ${t.id}: ${lint.filesChecked} files, ${lint.errors.length} errors (${((Date.now() - started) / 1000).toFixed(1)} s)`,
    );
    if (commentsFor) writeComments(o.launcher, t, version, commentsFile, o.log);
    if (formatTarget) writeFormat(o.launcher, t, version, o.force, o.log);
  }
  return results;
}

/** Writes `<id>.comments.json`: where nf-lang's CommentAttacher put each comment of the target's scripts. */
function writeComments(
  launcher: string,
  target: { id: string; sha: string; dir: string },
  version: string,
  file: string,
  log: (line: string) => void,
): void {
  const started = Date.now();
  const dump = dumpComments(launcher, target.dir);
  const result: CommentDumpResult = {
    id: target.id,
    sha: target.sha,
    nextflowVersion: version,
    ...dump,
  };
  writeFileSync(file, `${JSON.stringify(result)}\n`);
  const comments = dump.files.reduce(
    (n, f) => n + ("comments" in f ? f.comments.length : 0),
    0,
  );
  log(
    `corpus-lint: ${target.id}: ${dump.files.length} scripts, ${comments} comments (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
}

/** Writes `<id>.format/` and `<id>.format.json`, unless both are there for this pin and Nextflow version. */
function writeFormat(
  launcher: string,
  target: { id: string; sha: string; dir: string },
  version: string,
  force: boolean | undefined,
  log: (line: string) => void,
): void {
  const file = join(LINT_CACHE_DIR, `${target.id}.format.json`);
  const tree = join(LINT_CACHE_DIR, `${target.id}.format`);
  if (!force && existsSync(tree) && isCached(file, target.sha, version)) {
    log(`corpus-lint: ${target.id} format up to date`);
    return;
  }
  const started = Date.now();
  // a half-written tree must not look cached
  rmSync(file, { force: true });
  const formatted = formatDir(launcher, target.dir, tree);
  const result: FormatResult = {
    id: target.id,
    sha: target.sha,
    nextflowVersion: version,
    ...formatted,
  };
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  log(
    `corpus-lint: ${target.id}: ${formatted.filesFormatted} files formatted (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
}
