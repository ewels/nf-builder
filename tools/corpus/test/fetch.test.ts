import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncCorpus } from "../src/fetch.ts";
import { loadManifest } from "../src/manifest.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TIMEOUT = 20_000;
const IDENT = [
  "-c",
  "user.name=corpus-test",
  "-c",
  "user.email=corpus-test@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "nf-builder-corpus-")));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(args: string[], cwd?: string): string {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function makeRemote(repo: string): { first: string; second: string } {
  const bare = join(root, "remotes", `${repo}.git`);
  mkdirSync(dirname(bare), { recursive: true });
  git(["init", "--quiet", "--bare", bare]);
  const work = join(root, "work", repo);
  mkdirSync(work, { recursive: true });
  git(["-c", "init.defaultBranch=main", "init", "--quiet", work]);
  writeFileSync(join(work, "a.txt"), "a\n");
  git(["add", "."], work);
  git([...IDENT, "commit", "--quiet", "-m", "one"], work);
  const first = git(["rev-parse", "HEAD"], work);
  writeFileSync(join(work, "b.txt"), "b\n");
  git(["add", "."], work);
  git([...IDENT, "commit", "--quiet", "-m", "two"], work);
  const second = git(["rev-parse", "HEAD"], work);
  git(["push", "--quiet", bare, "HEAD:refs/heads/main"], work);
  return { first, second };
}

const gitEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: `url.file://${root}/remotes/.insteadOf`,
  GIT_CONFIG_VALUE_0: "https://github.com/",
});

function fakeGitPath(): string {
  const bin = join(root, "fakebin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\necho "$@" >> "${root}/git-called"\nexit 1\n`,
    { mode: 0o755 },
  );
  return `${bin}:${dirname(process.execPath)}`;
}

function sleepingGitPath(): string {
  const bin = join(root, "sleepbin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "git"),
    `#!${process.execPath}\nsetTimeout(() => {}, 5000);\n`,
    {
      mode: 0o755,
    },
  );
  return `${bin}:${dirname(process.execPath)}`;
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const manifestText = (pins: { id: string; repo: string; sha: string }[]) =>
  `pipelines:\n${pins
    .map(
      (p) =>
        `  - id: ${p.id}\n    repo: ${p.repo}\n    ref: main\n    sha: "${p.sha}"\n`,
    )
    .join("")}`;

function setup() {
  const alpha = makeRemote("test-owner/alpha");
  const beta = makeRemote("test-owner/beta");
  const manifest = join(root, "corpus.yaml");
  const cache = join(root, "cache");
  const write = (alphaSha: string, betaSha: string) =>
    writeFileSync(
      manifest,
      manifestText([
        { id: "alpha", repo: "test-owner/alpha", sha: alphaSha },
        { id: "beta", repo: "test-owner/beta", sha: betaSha },
      ]),
    );
  write(alpha.first, beta.second);
  return { alpha, beta, manifest, cache, write };
}

const base = (m: string, c: string) => ["--manifest", m, "--cache-dir", c];

describe("pnpm corpus:fetch", { timeout: TIMEOUT }, () => {
  it("F-009 step 1 ADR-0011: corpus:fetch checks out each pin by full commit SHA into the cache, without .git, and records the SHA", () => {
    const { alpha, manifest, cache } = setup();
    const r = runCli(base(manifest, cache), gitEnv());
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(cache, "alpha", "a.txt"))).toBe(true);
    expect(existsSync(join(cache, "alpha", "b.txt"))).toBe(false);
    expect(existsSync(join(cache, "beta", "b.txt"))).toBe(true);
    expect(existsSync(join(cache, "alpha", ".git"))).toBe(false);
    expect(existsSync(join(cache, "beta", ".git"))).toBe(false);
    expect(readFileSync(join(cache, "alpha.complete"), "utf8")).toBe(
      `${alpha.first}\n`,
    );
    expect(readdirSync(cache).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(r.stdout).toContain("alpha fetched");
    expect(r.stdout).toContain("2 fetched, 0 up to date");
  });

  it("F-009 step 2: a second run is a no-op and never calls git", () => {
    const { manifest, cache } = setup();
    expect(runCli(base(manifest, cache), gitEnv()).status).toBe(0);
    const before = [
      statSync(join(cache, "alpha")).mtimeMs,
      statSync(join(cache, "alpha.complete")).mtimeMs,
    ];
    const env = { ...gitEnv(), PATH: fakeGitPath() };
    const r = runCli(base(manifest, cache), env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("alpha up to date");
    expect(r.stdout).toContain("0 fetched, 2 up to date");
    expect(existsSync(join(root, "git-called"))).toBe(false);
    expect([
      statSync(join(cache, "alpha")).mtimeMs,
      statSync(join(cache, "alpha.complete")).mtimeMs,
    ]).toEqual(before);
  });

  it("F-009 step 2 ADR-0011: with every real pin cached, pnpm corpus:fetch on the real corpus.yaml makes no git call", () => {
    const cache = join(root, "cache");
    const { pipelines } = loadManifest();
    for (const p of pipelines) {
      mkdirSync(join(cache, p.id), { recursive: true });
      writeFileSync(join(cache, `${p.id}.complete`), `${p.sha}\n`);
    }
    const env = { ...process.env, PATH: fakeGitPath() };
    const r = runCli(["--cache-dir", cache], env);
    expect(r.status, r.stderr).toBe(0);
    for (const p of pipelines) expect(r.stdout).toContain(`${p.id} up to date`);
    expect(r.stdout.match(/ up to date \(/g)).toHaveLength(5);
    expect(r.stdout).toContain("0 fetched, 5 up to date");
    expect(existsSync(join(root, "git-called"))).toBe(false);
  });

  it("F-009: changing a pin fetches only that pipeline again", () => {
    const { alpha, manifest, cache, write, beta } = setup();
    expect(runCli(base(manifest, cache), gitEnv()).status).toBe(0);
    write(alpha.second, beta.second);
    const r = runCli(base(manifest, cache), gitEnv());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("alpha fetched");
    expect(r.stdout).toContain("beta up to date");
    expect(existsSync(join(cache, "alpha", "b.txt"))).toBe(true);
  });

  it("F-009: a commit missing from the remote fails with the pipeline, ref and SHA named and leaves no partial entry", () => {
    const { manifest, cache, write, beta } = setup();
    const bad = `${"0".repeat(39)}1`;
    write(bad, beta.second);
    const r = runCli(base(manifest, cache), gitEnv());
    expect(r.status).toBe(1);
    for (const part of [
      "alpha",
      "test-owner/alpha@",
      bad,
      "not our ref",
      "ADR 0011",
    ])
      expect(r.stderr).toContain(part);
    for (const f of ["alpha", "alpha.complete", "alpha.tmp"])
      expect(existsSync(join(cache, f))).toBe(false);
  });

  it("F-009: a failing pin doesn't stop the others", () => {
    const { manifest, cache, write, beta } = setup();
    write(`${"0".repeat(39)}1`, beta.second);
    const r = runCli(base(manifest, cache), gitEnv());
    expect(r.status).toBe(1);
    expect(existsSync(join(cache, "beta.complete"))).toBe(true);
    expect(r.stderr).toContain("1 of 2 pipelines failed");
  });

  it("F-009 step 2: --check verifies the cache without calling git, after pnpm's leading --", () => {
    const { manifest, cache } = setup();
    const args = ["--", "--check", ...base(manifest, cache)];
    const fake = { ...gitEnv(), PATH: fakeGitPath() };
    const missing = runCli(args, fake);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("alpha (");
    expect(missing.stderr).toContain("run pnpm corpus:fetch");
    expect(existsSync(join(root, "git-called"))).toBe(false);
    expect(runCli(base(manifest, cache), gitEnv()).status).toBe(0);
    const ok = runCli(args, fake);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("2 pipelines up to date");
  });

  it("F-009: a GIT_DIR inherited from a git hook doesn't redirect the fetch", () => {
    const { manifest, cache } = setup();
    const decoy = join(root, "decoy");
    mkdirSync(decoy);
    git(["init", "--quiet", decoy]);
    const r = runCli(base(manifest, cache), {
      ...gitEnv(),
      GIT_DIR: join(decoy, ".git"),
    });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(cache, "alpha", "a.txt"))).toBe(true);
    expect(existsSync(join(decoy, ".git", "FETCH_HEAD"))).toBe(false);
  });

  it("F-009: a git command that exceeds the timeout fails with a could-not-fetch message naming the timeout", () => {
    const pin = {
      id: "alpha",
      repo: "test-owner/alpha",
      ref: "main",
      sha: "1".repeat(40),
    };
    const saved = process.env.PATH;
    process.env.PATH = sleepingGitPath();
    try {
      const result = syncCorpus(
        { pipelines: [pin] },
        join(root, "cache"),
        () => {},
        200,
      );
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.message).toContain("could not fetch alpha");
      expect(result.failed[0]?.message).toContain("timed out after 200 ms");
      expect(existsSync(join(root, "cache", "alpha.tmp"))).toBe(false);
    } finally {
      process.env.PATH = saved;
    }
  });

  it("F-009: unknown options and manifest problems exit 2 with a message", () => {
    const env = gitEnv();
    const usage = runCli(["--nope"], env);
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain("Usage: pnpm corpus:fetch");
    const manifest = join(root, "bad.yaml");
    writeFileSync(
      manifest,
      "pipelines:\n  - id: alpha\n    repo: o/a\n    ref: main\n    sha: abc\n",
    );
    const bad = runCli(["--manifest", manifest], env);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain(`${manifest}: pipelines[0]`);
  });
});
