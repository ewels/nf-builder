import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isCached,
  type LintResult,
  lintDir,
  nextflowVersion,
  parseCommentDump,
  parseLintJson,
  resolveLauncher,
} from "../src/lint.ts";

const CLI = fileURLToPath(new URL("../src/lint-cli.ts", import.meta.url));
const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );
const temp = () => mkdtempSync(join(tmpdir(), "corpus-lint-"));

function fakeLauncher(dir: string, script: string): string {
  const file = join(dir, "fake-nextflow");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe("corpus comment dump", () => {
  it("F-102 AR-02: parseCommentDump reads CommentDump.java output, with JVM notices before it and rejected files as errors", () => {
    const row = {
      line: 2,
      column: 5,
      text: "// c",
      slot: "leading",
      node: {
        class: "ExpressionStatement",
        line: 3,
        column: 5,
        endLine: 3,
        endColumn: 9,
      },
    };
    const json = JSON.stringify({
      files: [
        { file: "main.nf", comments: [row] },
        { file: "bad.nf", error: "Unexpected input" },
      ],
    });
    const parsed = parseCommentDump(
      `Picked up JAVA_TOOL_OPTIONS: -Dx\n${json}\n`,
    );
    expect(parsed.files).toEqual([
      { file: "main.nf", comments: [row] },
      { file: "bad.nf", error: "Unexpected input" },
    ]);
    expect(() => parseCommentDump("boom")).toThrow(/not JSON/);
    expect(() => parseCommentDump('{"files": 1}')).toThrow(/no files list/);
    expect(() =>
      parseCommentDump(
        JSON.stringify({
          files: [{ file: "a.nf", comments: [{ ...row, slot: "sideways" }] }],
        }),
      ),
    ).toThrow(/unexpected comment entry/);
    expect(() =>
      parseCommentDump(JSON.stringify({ files: [{ file: "a.nf" }] })),
    ).toThrow(/no comments or error/);
  });
});

describe("corpus lint", () => {
  it("F-006 step 2: parseLintJson reads nextflow lint -o json output", () => {
    const fixtures = parseLintJson(fixture("lint-fixtures.json"));
    expect(fixtures.filesChecked).toBe(9);
    expect(fixtures.errors).toHaveLength(11);
    expect(fixtures.errors[0]).toEqual({
      filename: "bad-declaration.nf",
      startLine: 23,
      startColumn: 18,
      message: "Unexpected input: '='",
    });
    const clean = parseLintJson(fixture("lint-rnaseq-nf.json"));
    expect(clean).toEqual({ filesChecked: 7, errors: [] });
    expect(() => parseLintJson("not json")).toThrow(/not JSON/);
  });

  it("F-006 step 2: a cached lint result is reused only when the pin SHA and Nextflow version match", () => {
    const file = join(temp(), "x.json");
    const result: LintResult = {
      id: "x",
      sha: "a".repeat(40),
      nextflowVersion: "26.10.7",
      filesChecked: 1,
      errors: [],
    };
    expect(isCached(file, result.sha, "26.10.7")).toBe(false);
    writeFileSync(file, JSON.stringify(result));
    expect(isCached(file, result.sha, "26.10.7")).toBe(true);
    expect(isCached(file, "b".repeat(40), "26.10.7")).toBe(false);
    expect(isCached(file, result.sha, "26.10.8")).toBe(false);
    writeFileSync(file, "{broken");
    expect(isCached(file, result.sha, "26.10.7")).toBe(false);
  });

  it("F-006: the launcher is the flag, else NXF_LAUNCHER, else the pinned dist read from upstream.json", () => {
    const dir = temp();
    const upstream = join(dir, "upstream.json");
    writeFileSync(upstream, JSON.stringify({ nextflow: { version: "1.2.3" } }));
    const base = { upstreamFile: upstream, repoRoot: dir };
    expect(
      resolveLauncher({ ...base, flag: "/a", env: { NXF_LAUNCHER: "/b" } }),
    ).toEqual({ path: "/a" });
    expect(resolveLauncher({ ...base, env: { NXF_LAUNCHER: "/b" } })).toEqual({
      path: "/b",
    });
    expect(resolveLauncher({ ...base, env: {} })).toEqual({
      path: join(dir, ".cache/nextflow/1.2.3/nextflow-1.2.3-dist"),
    });
  });

  it("F-006: corpus:lint without a launcher exits 2 and says how to provide one", () => {
    const dir = temp();
    const upstream = join(dir, "upstream.json");
    writeFileSync(upstream, JSON.stringify({ nextflow: { version: "0.0.1" } }));
    const env = { ...process.env };
    delete env.NXF_LAUNCHER;
    const run = spawnSync(process.execPath, [CLI, "--upstream", upstream], {
      encoding: "utf8",
      env,
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--nextflow");
    expect(run.stderr).toContain("NXF_LAUNCHER");
    expect(run.stderr).toContain("nextflow-0.0.1-dist");
  });

  it("F-006: lint output that is not JSON is a failure that shows the stderr tail", () => {
    const dir = temp();
    const launcher = fakeLauncher(
      dir,
      'echo "boom: no java" >&2; echo "garbage"; exit 3',
    );
    expect(() => lintDir(launcher, dir)).toThrow(/boom: no java/);
    const ok = fakeLauncher(
      temp(),
      `cat <<'EOF'\n${fixture("lint-rnaseq-nf.json")}\nEOF\nexit 0`,
    );
    expect(lintDir(ok, dir).filesChecked).toBe(7);
    const exitOne = fakeLauncher(
      temp(),
      `cat <<'EOF'\n${fixture("lint-fixtures.json")}\nEOF\nexit 1`,
    );
    expect(lintDir(exitOne, dir).errors).toHaveLength(11);
  });

  it("F-006: the Nextflow version comes from the pinned dist file name without starting Java, else from -version", () => {
    const dir = temp();
    const versioned = join(dir, "9.9.9");
    mkdirSync(versioned);
    expect(nextflowVersion(join(versioned, "nextflow-9.9.9-dist"))).toBe(
      "9.9.9",
    );
    const launcher = fakeLauncher(
      dir,
      'echo "      version 26.10.7 build 15252"',
    );
    expect(nextflowVersion(launcher)).toBe("26.10.7");
  });
});
