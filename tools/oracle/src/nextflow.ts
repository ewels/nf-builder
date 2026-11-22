import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";
import { NEXTFLOW_CACHE } from "./paths.ts";
import { distPath, distUrl, type NextflowPin } from "./pin.ts";

type Download = (url: string, dest: string) => void;

const curlDownload: Download = (url, dest) => {
  const result = spawnSync("curl", ["-fsSL", "--retry", "3", "-o", dest, url], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.error) {
    throw new Error(
      `cannot run curl (${result.error.message}); install curl, or download ${url} to ${dest} by hand`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`curl failed with status ${result.status} for ${url}`);
  }
};

export function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

type EnsureOptions = {
  nextflowCache?: string;
  download?: Download;
  log?: (line: string) => void;
};

const hashOrNull = (file: string): string | null => {
  try {
    return sha256File(file);
  } catch {
    return null;
  }
};

/** Returns the absolute path of a verified, executable -dist file. Downloads only when it's missing or its hash differs. */
export function ensureNextflow(
  pin: NextflowPin,
  options: EnsureOptions = {},
): string {
  const {
    nextflowCache = NEXTFLOW_CACHE,
    download = curlDownload,
    log = () => {},
  } = options;
  const dest = distPath(pin.version, nextflowCache);
  if (hashOrNull(dest) === pin.sha256) {
    chmodSync(dest, 0o755);
    return dest;
  }
  const url = distUrl(pin.version);
  const part = `${dest}.part`;
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { force: true });
  rmSync(part, { force: true });
  log(`Downloading ${url}`);
  try {
    download(url, part);
    const actual = sha256File(part);
    if (actual !== pin.sha256) {
      throw new Error(
        `SHA-256 mismatch for ${url}: expected ${pin.sha256}, got ${actual}`,
      );
    }
    chmodSync(part, 0o755);
    renameSync(part, dest);
  } finally {
    rmSync(part, { force: true });
  }
  return dest;
}

export const DROPPED_ENV: readonly string[] = [
  "NXF_VER",
  "NXF_EDGE",
  "NXF_BASE",
  "NXF_DIST",
  "NXF_JAR",
  "NXF_BIN",
  "NXF_URL",
  "NXF_LAUNCHER",
  "NXF_CLASSPATH",
  "NXF_GRAB",
  "NXF_PROT",
];

export function nextflowEnv(
  base: NodeJS.ProcessEnv,
  nextflowCache: string = NEXTFLOW_CACHE,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of DROPPED_ENV) delete env[key];
  return {
    ...env,
    NXF_HOME: `${nextflowCache}/home`,
    NXF_OFFLINE: "true",
    NXF_DISABLE_CHECK_LATEST: "true",
    NXF_ANSI_LOG: "false",
    NXF_SYNTAX_PARSER: "v2",
  };
}

export type ExecResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};
/** `pathPrefix` is a directory put first on PATH for this command. */
export type ExecOptions = { pathPrefix?: string };
export type Exec = (
  args: readonly string[],
  cwd: string,
  options?: ExecOptions,
) => ExecResult;

export function nextflowExec(dist: string, env: NodeJS.ProcessEnv): Exec {
  return (args, cwd, options) => {
    const started = Date.now();
    const result = spawnSync(dist, [...args], {
      cwd,
      env: options?.pathPrefix
        ? { ...env, PATH: `${options.pathPrefix}:${env.PATH ?? ""}` }
        : env,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      durationMs: Date.now() - started,
    };
  };
}

/** Parses "version 26.10.7 build ..." from `nextflow -version` output; null if absent. */
export function parseVersion(output: string): string | null {
  return /\bversion\s+(\d+\.\d+\.\d+)\b/.exec(output)?.[1] ?? null;
}
