import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchSnapshotBranch,
  registrySnapshot,
  snapshotSource,
} from "../scripts/registry-snapshot-site.ts";

const golden = join(
  import.meta.dirname,
  "../tools/registry-snapshot/test/fixtures/expected",
);
const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const originalPath = process.env.PATH;
const originalTmp = process.env.TMPDIR;
const dirs: string[] = [];
afterEach(() => {
  process.env.PATH = originalPath;
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "nf-site-"));
  dirs.push(d);
  return d;
};
const git = (cwd: string, ...args: string[]): void => {
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { cwd, stdio: "pipe" },
  );
};

/**
 * A local repository: `main` always; a `registry-snapshot` branch holding registry/** ("snapshot"), only a
 * netlify.toml ("empty"), or none (false).
 */
function repo(branch: "snapshot" | "empty" | false): string {
  const dir = tmp();
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "main");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "main");
  if (branch) {
    git(dir, "checkout", "-q", "--orphan", "registry-snapshot");
    git(dir, "rm", "-rqf", ".");
    if (branch === "snapshot")
      cpSync(join(golden, "registry"), join(dir, "registry"), {
        recursive: true,
      });
    writeFileSync(join(dir, "netlify.toml"), '[build]\nignore = "exit 0"\n');
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "snapshot");
    git(dir, "checkout", "-q", "main");
  }
  return pathToFileURL(dir).href;
}

/** Puts a `git` first on PATH that logs its arguments and GIT_TERMINAL_PROMPT, then runs the real one. */
function gitLog(): string {
  const bin = tmp();
  const log = join(bin, "git.log");
  const script = join(bin, "git");
  writeFileSync(
    script,
    `#!/bin/sh\nprintf '%s\\n' "prompt=$GIT_TERMINAL_PROMPT" "$@" >> "${log}"\nexec "${realGit}" "$@"\n`,
  );
  chmodSync(script, 0o755);
  process.env.PATH = `${bin}:${originalPath}`;
  return log;
}

type Emitted = { fileName: string; source: Uint8Array | string };
async function build(
  env: Record<string, string | undefined>,
): Promise<{ emitted: Emitted[]; warnings: string[] }> {
  const emitted: Emitted[] = [];
  const warnings: string[] = [];
  const plugin = registrySnapshot(env);
  expect(plugin.apply).toBe("build");
  const hook = plugin.generateBundle as (this: unknown) => void;
  hook.call({
    emitFile: (file: Emitted) => emitted.push(file),
    warn: (message: string) => warnings.push(message),
  });
  return { emitted, warnings };
}

describe("F-501 registry snapshot site plugin", () => {
  it("F-501 step 1 IO-31: on Netlify the build fetches the registry-snapshot branch and emits registry/**", async () => {
    const { emitted, warnings } = await build({
      NETLIFY: "true",
      REPOSITORY_URL: repo("snapshot"),
    });
    expect(warnings).toEqual([]);
    const names = emitted.map((f) => f.fileName);
    expect(names).toContain("registry/index.json");
    expect(names).toContain("registry/ports.json");
    expect(names).toContain(
      "registry/modules/nf-core/fastqc/0.0.0-6d1763b.json",
    );
    // Only registry/**: the branch's netlify.toml and git metadata stay out.
    expect(names.every((n) => n.startsWith("registry/"))).toBe(true);
    const index = emitted.find((f) => f.fileName === "registry/index.json");
    expect(
      JSON.parse(Buffer.from(index?.source ?? "").toString("utf8")).format,
    ).toBe(1);
  });

  it("F-501 step 1: a missing branch warns and emits nothing", async () => {
    const { emitted, warnings } = await build({
      NETLIFY: "true",
      REPOSITORY_URL: repo(false),
    });
    expect(emitted).toEqual([]);
    expect(warnings.join()).toMatch(/registry-snapshot/);
    expect(
      fetchSnapshotBranch(repo(false), "registry-snapshot", tmp()),
    ).toMatchObject({
      fetched: false,
      reason: expect.stringContaining("no registry-snapshot branch"),
    });
  });

  it("F-501 step 1: a repository that can't be read (a private one without a token) warns that the snapshot is unavailable and the build still succeeds", async () => {
    const log = gitLog();
    const { emitted, warnings } = await build({
      NETLIFY: "true",
      REPOSITORY_URL: pathToFileURL(join(tmp(), "no-such-repo")).href,
    });
    expect(emitted).toEqual([]);
    expect(warnings.join()).toMatch(/unavailable/);
    expect(warnings.join()).toMatch(/without \/registry\//);
    // Git never prompts for a username, and no token means no auth header.
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("prompt=0");
    expect(calls).not.toContain("http.extraheader");
  });

  it("F-501 step 1: REGISTRY_SNAPSHOT_TOKEN is passed to git as a basic-auth header, never in the URL", async () => {
    const log = gitLog();
    await build({
      NETLIFY: "true",
      REPOSITORY_URL: repo("snapshot"),
      REGISTRY_SNAPSHOT_TOKEN: "s3cret",
    });
    const calls = readFileSync(log, "utf8");
    const header = `http.extraheader=AUTHORIZATION: basic ${Buffer.from("x-access-token:s3cret").toString("base64")}`;
    expect(calls).toContain(header);
    expect(calls).toContain("prompt=0");
    expect(calls).not.toContain("s3cret");
  });

  it("F-501 step 1: only an unexpected failure after a successful read (a branch without registry/) fails the build, and the temporary directory is always removed", async () => {
    const scratch = tmp();
    process.env.TMPDIR = scratch;
    await expect(
      build({ NETLIFY: "true", REPOSITORY_URL: repo("empty") }),
    ).rejects.toThrow();
    await build({ NETLIFY: "true", REPOSITORY_URL: repo(false) });
    await build({
      NETLIFY: "true",
      REPOSITORY_URL: pathToFileURL(join(scratch, "no-such-repo")).href,
    });
    await build({ NETLIFY: "true", REPOSITORY_URL: repo("snapshot") });
    expect(
      readdirSync(scratch).filter((n) => n.startsWith("nf-registry-snapshot-")),
    ).toEqual([]);
  });

  it("F-501: REGISTRY_SNAPSHOT_DIR wins; with neither variable nothing is emitted", async () => {
    const fromDir = await build({
      REGISTRY_SNAPSHOT_DIR: golden,
      NETLIFY: "true",
      REPOSITORY_URL: repo(false),
    });
    expect(fromDir.warnings).toEqual([]);
    expect(fromDir.emitted.map((f) => f.fileName)).toContain(
      "registry/index.json",
    );
    expect(fromDir.emitted.length).toBeGreaterThan(5);

    expect(await build({})).toEqual({ emitted: [], warnings: [] });
    expect(await build({ REPOSITORY_URL: repo("snapshot") })).toEqual({
      emitted: [],
      warnings: [],
    });
  });

  it("F-501: snapshotSource reads the environment and turns Netlify's SSH repository URL into https", () => {
    expect(snapshotSource({ REGISTRY_SNAPSHOT_DIR: "/x" })).toEqual({
      kind: "dir",
      dir: "/x",
    });
    expect(
      snapshotSource({
        NETLIFY: "true",
        REPOSITORY_URL: "git@github.com:owner/repo",
      }),
    ).toEqual({
      kind: "branch",
      url: "https://github.com/owner/repo.git",
      branch: "registry-snapshot",
      token: undefined,
    });
    expect(
      snapshotSource({
        NETLIFY: "true",
        REPOSITORY_URL: "https://github.com/o/r",
        REGISTRY_SNAPSHOT_TOKEN: "t",
      }),
    ).toMatchObject({ url: "https://github.com/o/r", token: "t" });
    expect(snapshotSource({ NETLIFY: "true" })).toEqual({ kind: "none" });
    expect(snapshotSource({})).toEqual({ kind: "none" });
  });
});
