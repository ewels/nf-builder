// F-501, IO-31: serves the registry snapshot at /registry/ (ADR 0034). The snapshot is not in the repository: the
// `Registry snapshot` workflow publishes it to the orphan branch `registry-snapshot`, and each build copies it in.
// - REGISTRY_SNAPSHOT_DIR (tests, local runs): copy <dir>/registry/**.
// - Otherwise on Netlify (NETLIFY=true): fetch the branch from REPOSITORY_URL with git. A missing branch warns and emits
//   nothing (deploys before the first run); any other git error fails the build, so the previous deploy stays live.
// - Otherwise: emit nothing.
import { execFileSync } from "node:child_process";
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

export const SNAPSHOT_BRANCH = "registry-snapshot";

export type SnapshotSource =
  | { kind: "dir"; dir: string }
  | { kind: "branch"; url: string; branch: string }
  | { kind: "none" };

export function snapshotSource(
  env: Record<string, string | undefined>,
): SnapshotSource {
  if (env.REGISTRY_SNAPSHOT_DIR)
    return { kind: "dir", dir: env.REGISTRY_SNAPSHOT_DIR };
  if (env.NETLIFY !== "true" || !env.REPOSITORY_URL) return { kind: "none" };
  // Netlify may give the SSH form; the repository is read anonymously over https.
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(env.REPOSITORY_URL);
  const url = ssh ? `https://${ssh[1]}/${ssh[2]}.git` : env.REPOSITORY_URL;
  return { kind: "branch", url, branch: SNAPSHOT_BRANCH };
}

/** Shallow-clones `branch` of `url` into `into`. "missing" when the remote has no such branch. */
export function fetchSnapshotBranch(
  url: string,
  branch: string,
  into: string,
): "fetched" | "missing" {
  const run = (args: string[]): void =>
    void execFileSync("git", args, { stdio: "pipe" });
  try {
    run(["ls-remote", "--exit-code", "--heads", url, branch]);
  } catch (error) {
    // `ls-remote --exit-code` exits 2 when no ref matches; anything else is a real failure.
    if ((error as { status?: number }).status === 2) return "missing";
    throw new Error(
      `git ls-remote ${url} failed: ${String((error as { stderr?: unknown }).stderr ?? error)}`,
    );
  }
  run([
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
  return "fetched";
}

function* files(dir: string, base = ""): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path, `${base}${name}/`);
    else yield `${base}${name}`;
  }
}

/** Emits the snapshot's registry/** files as assets of the production build. */
export function registrySnapshot(
  env: Record<string, string | undefined>,
): Plugin {
  return {
    name: "nf-builder:registry-snapshot",
    apply: "build",
    async generateBundle() {
      const source = snapshotSource(env);
      if (source.kind === "none") return;
      let root: string;
      let temporary: string | undefined;
      if (source.kind === "dir") root = source.dir;
      else {
        temporary = mkdtempSync(join(tmpdir(), "nf-registry-snapshot-"));
        root = temporary;
        if (
          fetchSnapshotBranch(source.url, source.branch, temporary) ===
          "missing"
        ) {
          rmSync(temporary, { recursive: true, force: true });
          this.warn(
            `The branch ${source.branch} does not exist yet: the site is built without /registry/. Run the Registry snapshot workflow.`,
          );
          return;
        }
      }
      try {
        for (const rel of files(join(root, "registry")))
          this.emitFile({
            type: "asset",
            fileName: `registry/${rel}`,
            source: readFileSync(join(root, "registry", rel)),
          });
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true });
      }
    },
  } as Plugin;
}
