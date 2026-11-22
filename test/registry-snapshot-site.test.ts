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
 * placeholder file ("empty"), or none (false).
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
    writeFileSync(join(dir, "placeholder.txt"), "no registry here\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "snapshot");
    git(dir, "checkout", "-q", "main");
  }
  return pathToFileURL(dir).href;
}

/**
 * Puts a `git` first on PATH that logs GIT_TERMINAL_PROMPT, the GIT_CONFIG_* environment and each argument (as
 * `env:` and `arg:` lines), then runs the real one. With NF_FAIL_CLONE set, `git clone` fails after printing a line.
 */
function gitLog(): string {
  const bin = tmp();
  const log = join(bin, "git.log");
  const script = join(bin, "git");
  writeFileSync(
    script,
    `#!/bin/sh
{
  printf 'env:prompt=%s\n' "$GIT_TERMINAL_PROMPT"
  n=$(( \${GIT_CONFIG_COUNT:-0} - 1 ))
  if [ "$n" -ge 0 ]; then eval "k=\\$GIT_CONFIG_KEY_$n v=\\$GIT_CONFIG_VALUE_$n"; else k=; v=; fi
  printf 'env:config=%s|%s\n' "$k" "$v"
  for a in "$@"; do printf 'arg:%s\n' "$a"; done
} >> "${log}"
if [ "$1" = clone ] && [ -n "$NF_FAIL_CLONE" ]; then
  printf 'fatal: simulated clone failure\nsecond line\n' >&2
  exit 128
fi
exec "${realGit}" "$@"
`,
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
  it("F-501 step 1 IO-31: with REGISTRY_SNAPSHOT_REPO the build fetches the registry-snapshot branch and emits registry/**", async () => {
    const { emitted, warnings } = await build({
      REGISTRY_SNAPSHOT_REPO: repo("snapshot"),
    });
    expect(warnings).toEqual([]);
    const names = emitted.map((f) => f.fileName);
    expect(names).toContain("registry/index.json");
    expect(names).toContain("registry/ports.json");
    expect(names).toContain(
      "registry/modules/nf-core/fastqc/0.0.0-6d1763b.json",
    );
    // Only registry/**: the branch's other files and git metadata stay out.
    expect(names.every((n) => n.startsWith("registry/"))).toBe(true);
    const index = emitted.find((f) => f.fileName === "registry/index.json");
    expect(
      JSON.parse(Buffer.from(index?.source ?? "").toString("utf8")).format,
    ).toBe(1);
  });

  it("F-501 step 1: a missing branch warns and emits nothing", async () => {
    const { emitted, warnings } = await build({
      REGISTRY_SNAPSHOT_REPO: repo(false),
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

  it("F-501 step 1: a repository that can't be read warns that the snapshot is unavailable and the build still succeeds", async () => {
    const log = gitLog();
    const { emitted, warnings } = await build({
      REGISTRY_SNAPSHOT_REPO: pathToFileURL(join(tmp(), "no-such-repo")).href,
    });
    expect(emitted).toEqual([]);
    expect(warnings.join()).toMatch(/unavailable/);
    expect(warnings.join()).toMatch(/without \/registry\//);
    // Git never prompts for a username, and there is no auth header.
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("env:prompt=0");
    expect(calls).not.toContain("extraheader");
  });

  it("F-501 step 1 ADR-0041: branch mode reads anonymously: git gets no Authorization header, the URL carries no credentials, and git never prompts", async () => {
    const url = repo("snapshot");
    const log = gitLog();
    await build({
      REGISTRY_SNAPSHOT_REPO: url,
      REGISTRY_SNAPSHOT_TOKEN: "s3cret",
    });
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("env:prompt=0");
    expect(calls).not.toMatch(/extraheader|authorization/i);
    expect(calls).not.toContain("s3cret");
    for (const line of calls.split("\n").filter((l) => l.startsWith("arg:")))
      expect(line).not.toMatch(/@/);
  });

  it("F-501 step 1: when the clone fails after a successful ls-remote the error names the exit code and one line of stderr, never the command line", async () => {
    gitLog();
    process.env.NF_FAIL_CLONE = "1";
    try {
      const failure = await build({
        REGISTRY_SNAPSHOT_REPO: repo("snapshot"),
      }).catch((error: unknown) => error as Error);
      expect(failure).toBeInstanceOf(Error);
      const text = `${(failure as Error).message}\n${(failure as Error).stack}`;
      expect(text).toContain("exit 128");
      expect(text).toContain("simulated clone failure");
      expect(text).not.toContain("second line");
      expect(text).not.toContain("Command failed");
    } finally {
      delete process.env.NF_FAIL_CLONE;
    }
  });

  it("F-501 step 1: only an unexpected failure after a successful read (a branch without registry/) fails the build, and the temporary directory is always removed", async () => {
    const scratch = tmp();
    process.env.TMPDIR = scratch;
    await expect(
      build({ REGISTRY_SNAPSHOT_REPO: repo("empty") }),
    ).rejects.toThrow();
    await build({ REGISTRY_SNAPSHOT_REPO: repo(false) });
    await build({
      REGISTRY_SNAPSHOT_REPO: pathToFileURL(join(scratch, "no-such-repo")).href,
    });
    await build({ REGISTRY_SNAPSHOT_REPO: repo("snapshot") });
    expect(
      readdirSync(scratch).filter((n) => n.startsWith("nf-registry-snapshot-")),
    ).toEqual([]);
  });

  it("F-501: REGISTRY_SNAPSHOT_DIR wins; with neither variable nothing is emitted", async () => {
    const fromDir = await build({
      REGISTRY_SNAPSHOT_DIR: golden,
      REGISTRY_SNAPSHOT_REPO: repo(false),
    });
    expect(fromDir.warnings).toEqual([]);
    expect(fromDir.emitted.map((f) => f.fileName)).toContain(
      "registry/index.json",
    );
    expect(fromDir.emitted.length).toBeGreaterThan(5);

    expect(await build({})).toEqual({ emitted: [], warnings: [] });
    expect(
      await build({
        NETLIFY: "true",
        REPOSITORY_URL: repo("snapshot"),
        REGISTRY_SNAPSHOT_TOKEN: "t",
      }),
    ).toEqual({
      emitted: [],
      warnings: [],
    });
  });

  it("F-501 ADR-0041: snapshotSource takes REGISTRY_SNAPSHOT_REPO, rewrites an SSH URL to https, and ignores NETLIFY, REPOSITORY_URL and REGISTRY_SNAPSHOT_TOKEN", () => {
    expect(snapshotSource({ REGISTRY_SNAPSHOT_DIR: "/x" })).toEqual({
      kind: "dir",
      dir: "/x",
    });
    expect(
      snapshotSource({ REGISTRY_SNAPSHOT_REPO: "git@github.com:owner/repo" }),
    ).toEqual({
      kind: "branch",
      url: "https://github.com/owner/repo.git",
      branch: "registry-snapshot",
    });
    expect(
      snapshotSource({ REGISTRY_SNAPSHOT_REPO: "https://github.com/o/r" }),
    ).toEqual({
      kind: "branch",
      url: "https://github.com/o/r",
      branch: "registry-snapshot",
    });
    expect(
      snapshotSource({
        NETLIFY: "true",
        REPOSITORY_URL: "https://github.com/o/r",
        REGISTRY_SNAPSHOT_TOKEN: "t",
      }),
    ).toEqual({ kind: "none" });
    expect(snapshotSource({})).toEqual({ kind: "none" });
  });
});
