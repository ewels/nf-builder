import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const dirs: string[] = [];
afterEach(() => {
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

/** A local repository with a `registry-snapshot` branch holding registry/** and a `main` branch without it. */
function repo(withBranch: boolean): string {
  const dir = tmp();
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "main");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "main");
  if (withBranch) {
    git(dir, "checkout", "-q", "--orphan", "registry-snapshot");
    git(dir, "rm", "-rqf", ".");
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

type Emitted = { fileName: string; source: Uint8Array | string };
async function build(
  env: Record<string, string | undefined>,
): Promise<{ emitted: Emitted[]; warnings: string[] }> {
  const emitted: Emitted[] = [];
  const warnings: string[] = [];
  const plugin = registrySnapshot(env);
  expect(plugin.apply).toBe("build");
  const hook = plugin.generateBundle as (this: unknown) => Promise<void>;
  await hook.call({
    emitFile: (file: Emitted) => emitted.push(file),
    warn: (message: string) => warnings.push(message),
  });
  return { emitted, warnings };
}

describe("F-501 registry snapshot site plugin", () => {
  it("F-501 step 1 IO-31: on Netlify the build fetches the registry-snapshot branch and emits registry/**", async () => {
    const { emitted, warnings } = await build({
      NETLIFY: "true",
      REPOSITORY_URL: repo(true),
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

  it("F-501 step 1: a missing branch warns and emits nothing; another git failure fails the build", async () => {
    const { emitted, warnings } = await build({
      NETLIFY: "true",
      REPOSITORY_URL: repo(false),
    });
    expect(emitted).toEqual([]);
    expect(warnings.join()).toMatch(/registry-snapshot/);
    expect(fetchSnapshotBranch(repo(false), "registry-snapshot", tmp())).toBe(
      "missing",
    );
    await expect(
      build({
        NETLIFY: "true",
        REPOSITORY_URL: pathToFileURL(join(tmp(), "no-such-repo")).href,
      }),
    ).rejects.toThrow();
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
    expect(await build({ REPOSITORY_URL: repo(true) })).toEqual({
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
    });
    expect(
      snapshotSource({
        NETLIFY: "true",
        REPOSITORY_URL: "https://github.com/o/r",
      }),
    ).toMatchObject({ url: "https://github.com/o/r" });
    expect(snapshotSource({ NETLIFY: "true" })).toEqual({ kind: "none" });
    expect(snapshotSource({})).toEqual({ kind: "none" });
  });
});
