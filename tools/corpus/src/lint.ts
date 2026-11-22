// Runs `nextflow lint -o json` over the pinned corpus and the malformed fixtures, and caches the results per pin and
// Nextflow version (F-006, ADR 0005, ADR 0003: standalone, no workspace imports). The Nextflow version is never named here:
// it comes from the launcher, which is the pinned dist in .cache/nextflow/ unless told otherwise.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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
  const results: LintResult[] = [];
  for (const t of targets) {
    const file = join(LINT_CACHE_DIR, `${t.id}.json`);
    if (!o.force && isCached(file, t.sha, version)) {
      results.push(JSON.parse(readFileSync(file, "utf8")) as LintResult);
      o.log(`corpus-lint: ${t.id} up to date`);
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
  }
  return results;
}
