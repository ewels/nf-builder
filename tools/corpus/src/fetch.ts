import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Manifest, Pipeline } from "./manifest.ts";

export type SyncResult = {
  fetched: Pipeline[];
  upToDate: Pipeline[];
  failed: { pipeline: Pipeline; message: string }[];
};

export const githubUrl = (repo: string): string =>
  `https://github.com/${repo}.git`;
export const pipelineDir = (cacheDir: string, pipeline: Pipeline): string =>
  join(cacheDir, pipeline.id);
export const markerFile = (cacheDir: string, pipeline: Pipeline): string =>
  join(cacheDir, `${pipeline.id}.complete`);

/** True when the marker holds exactly pipeline.sha (after trim) and pipelineDir is a directory. Never runs git. */
export function isUpToDate(cacheDir: string, pipeline: Pipeline): boolean {
  try {
    return (
      readFileSync(markerFile(cacheDir, pipeline), "utf8").trim() ===
        pipeline.sha && statSync(pipelineDir(cacheDir, pipeline)).isDirectory()
    );
  } catch {
    return false;
  }
}

export function missingPipelines(
  manifest: Manifest,
  cacheDir: string,
): Pipeline[] {
  return manifest.pipelines.filter((p) => !isUpToDate(cacheDir, p));
}

const REPO_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const name of REPO_ENV) delete env[name];
  return env;
}

class GitFailure extends Error {}

function git(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", env: gitEnv() });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(
        "git is not installed or not on PATH; install git to fetch the corpus",
      );
    throw new GitFailure(result.error.message);
  }
  if (result.status !== 0) {
    const lines = result.stderr.split("\n").filter((l) => l.trim() !== "");
    throw new GitFailure(lines.at(-1) ?? `git exited with ${result.status}`);
  }
  return result.stdout;
}

/** Fetches one pin. Throws an Error with the actionable message. */
export function fetchPipeline(
  cacheDir: string,
  pipeline: Pipeline,
  _log: (line: string) => void,
): void {
  const dir = pipelineDir(cacheDir, pipeline);
  const marker = markerFile(cacheDir, pipeline);
  const tmp = join(cacheDir, `${pipeline.id}.tmp`);
  const url = githubUrl(pipeline.repo);
  for (const path of [dir, marker, tmp])
    rmSync(path, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    git(["-c", "init.defaultBranch=main", "init", "--quiet", tmp]);
    git([
      "-C",
      tmp,
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "--no-tags",
      url,
      pipeline.sha,
    ]);
    git([
      "-C",
      tmp,
      "-c",
      "advice.detachedHead=false",
      "-c",
      "core.autocrlf=false",
      "checkout",
      "--quiet",
      "FETCH_HEAD",
    ]);
    const actual = git(["-C", tmp, "rev-parse", "HEAD"]).trim();
    if (actual !== pipeline.sha)
      throw new Error(
        `${pipeline.id}: checked out ${actual}, expected ${pipeline.sha}`,
      );
    rmSync(join(tmp, ".git"), { recursive: true, force: true });
    renameSync(tmp, dir);
    writeFileSync(marker, `${pipeline.sha}\n`);
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    if (!(error instanceof GitFailure)) throw error;
    throw new Error(
      `could not fetch ${pipeline.id} (${pipeline.repo}@${pipeline.ref} ${pipeline.sha}) from ${url}: ${error.message}. Check the network and that the commit exists on GitHub; pins change only in their own PR (ADR 0011).`,
    );
  }
}

/** For each pipeline in manifest order: skip if up to date, otherwise fetch. A failure is recorded and the loop continues. */
export function syncCorpus(
  manifest: Manifest,
  cacheDir: string,
  log: (line: string) => void,
): SyncResult {
  const result: SyncResult = { fetched: [], upToDate: [], failed: [] };
  mkdirSync(cacheDir, { recursive: true });
  for (const pipeline of manifest.pipelines) {
    const label = `${pipeline.repo}@${pipeline.ref}`;
    const short = pipeline.sha.slice(0, 12);
    if (isUpToDate(cacheDir, pipeline)) {
      log(`corpus: ${pipeline.id} up to date (${label} ${short})`);
      result.upToDate.push(pipeline);
      continue;
    }
    log(
      `corpus: ${pipeline.id} fetching ${label} (${short}) from ${githubUrl(pipeline.repo)}`,
    );
    try {
      fetchPipeline(cacheDir, pipeline, log);
      log(`corpus: ${pipeline.id} fetched`);
      result.fetched.push(pipeline);
    } catch (error) {
      result.failed.push({ pipeline, message: (error as Error).message });
    }
  }
  return result;
}
