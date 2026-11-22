// F-501, IO-31: serves the registry snapshot at /registry/ (ADR 0035). The snapshot is not in the repository: the
// `Registry snapshot` workflow publishes it to the orphan branch `registry-snapshot`, and each build copies it in.
// - REGISTRY_SNAPSHOT_DIR (tests, local runs): copy <dir>/registry/**.
// - Otherwise on Netlify (NETLIFY=true): read the branch from REPOSITORY_URL with git, authenticated with
//   REGISTRY_SNAPSHOT_TOKEN when set (the repository may be private), never prompting. If the branch can't be read (it
//   doesn't exist yet, or access is refused) the build warns and emits nothing, so the site builds without a snapshot.
//   Only an unexpected failure after a successful read, such as a corrupt clone, fails the build.
// - Otherwise: emit nothing.
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";

const SNAPSHOT_BRANCH = "registry-snapshot";

type SnapshotSource =
  | { kind: "dir"; dir: string }
  | { kind: "branch"; url: string; branch: string; token: string | undefined }
  | { kind: "none" };

export function snapshotSource(
  env: Record<string, string | undefined>,
): SnapshotSource {
  if (env.REGISTRY_SNAPSHOT_DIR)
    return { kind: "dir", dir: env.REGISTRY_SNAPSHOT_DIR };
  if (env.NETLIFY !== "true" || !env.REPOSITORY_URL) return { kind: "none" };
  // Netlify may give the SSH form, and the build has no SSH key: read over https.
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(env.REPOSITORY_URL);
  const url = ssh ? `https://${ssh[1]}/${ssh[2]}.git` : env.REPOSITORY_URL;
  return {
    kind: "branch",
    url,
    branch: SNAPSHOT_BRANCH,
    token: env.REGISTRY_SNAPSHOT_TOKEN || undefined,
  };
}

type Fetched = { fetched: true } | { fetched: false; reason: string };

/**
 * Shallow-clones `branch` of `url` into `into`. When the branch can't be read (missing, no access, any failure of
 * `git ls-remote`) it says why instead of throwing; a failure of the clone after a successful read throws.
 * The token goes to git through the environment, never argv, and errors carry only the exit code and one line of stderr,
 * because the build log shows messages and Netlify masks only the plain secret, not its base64.
 */
export function fetchSnapshotBranch(
  url: string,
  branch: string,
  into: string,
  token?: string,
): Fetched {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token) {
    // Append to any config the environment already carries.
    const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
    env.GIT_CONFIG_COUNT = String(n + 1);
    env[`GIT_CONFIG_KEY_${n}`] = "http.extraheader";
    env[`GIT_CONFIG_VALUE_${n}`] =
      `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  const git = (args: string[]): { status: number | null; failure: string } => {
    const result = spawnSync("git", args, { env, encoding: "utf8" });
    const line = (result.error?.message ?? result.stderr ?? "")
      .trim()
      .split("\n")[0];
    return {
      status: result.status,
      failure: `git ${args[0]} failed (exit ${result.status}): ${line}`,
    };
  };
  const list = git(["ls-remote", "--exit-code", "--heads", url, branch]);
  // `ls-remote --exit-code` exits 2 when no ref matches.
  if (list.status === 2)
    return { fetched: false, reason: `no ${branch} branch in ${url}` };
  if (list.status !== 0) return { fetched: false, reason: list.failure };
  const clone = git([
    "clone",
    "--quiet",
    "--depth",
    "1",
    "--branch",
    branch,
    "--single-branch",
    url,
    into,
  ]);
  if (clone.status !== 0) throw new Error(clone.failure);
  return { fetched: true };
}

/** Emits the snapshot's registry/** files as assets of the production build. */
export function registrySnapshot(
  env: Record<string, string | undefined>,
): Plugin {
  return {
    name: "nf-builder:registry-snapshot",
    apply: "build",
    generateBundle() {
      const source = snapshotSource(env);
      if (source.kind === "none") return;
      const root =
        source.kind === "dir"
          ? source.dir
          : mkdtempSync(join(tmpdir(), "nf-registry-snapshot-"));
      try {
        if (source.kind === "branch") {
          const result = fetchSnapshotBranch(
            source.url,
            source.branch,
            root,
            source.token,
          );
          if (!result.fetched) {
            this.warn(
              `The registry snapshot is unavailable (${result.reason}): the site is built without /registry/. Run the Registry snapshot workflow, and set REGISTRY_SNAPSHOT_TOKEN if the repository is private.`,
            );
            return;
          }
        }
        const dir = join(root, "registry");
        for (const rel of readdirSync(dir, {
          recursive: true,
          encoding: "utf8",
        }))
          if (statSync(join(dir, rel)).isFile())
            this.emitFile({
              type: "asset",
              fileName: `registry/${rel}`,
              source: readFileSync(join(dir, rel)),
            });
      } finally {
        if (source.kind === "branch")
          rmSync(root, { recursive: true, force: true });
      }
    },
  };
}
