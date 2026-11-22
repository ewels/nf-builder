import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateLint } from "../src/check.ts";
import { main } from "../src/cli.ts";
import { loadFixtures, runFixtures } from "../src/fixtures.ts";
import type { Exec, ExecResult } from "../src/nextflow.ts";
import { FIXTURES_FILE, REPO_ROOT } from "../src/paths.ts";
import { annotations } from "../src/report.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "oracle-fix-"));
const res = (over: Partial<ExecResult> = {}): ExecResult => ({
  status: 0,
  signal: null,
  stdout: JSON.stringify({ errors: [], warnings: [] }, null, 2),
  stderr: "",
  durationMs: 1,
  ...over,
});

const makeFixtures = (): string => {
  const dir = tmp();
  writeFileSync(join(dir, "good.nf"), "// ok\n");
  writeFileSync(join(dir, "bad.nf"), "// bad\n");
  const file = join(dir, "fixtures.yaml");
  writeFileSync(
    file,
    `fixtures:
  - file: good.nf
    breaks: ignored
    lint: ok
    expect: { wholeFile: true }
  - file: bad.nf
    lint: error
`,
  );
  return file;
};

describe("F-005 corpus fixtures", () => {
  it("F-005 ADR-0017: loadFixtures reads only file and lint, and reports a missing file or a bad lint value", () => {
    const { fixtures } = loadFixtures(makeFixtures());
    expect(fixtures.map((f) => [f.file, f.lint])).toEqual([
      ["good.nf", "ok"],
      ["bad.nf", "error"],
    ]);
    const dir = tmp();
    const file = join(dir, "fixtures.yaml");
    writeFileSync(
      file,
      "fixtures:\n  - file: gone.nf\n    lint: ok\n  - file: x.nf\n    lint: maybe\n",
    );
    writeFileSync(join(dir, "x.nf"), "");
    let message = "";
    try {
      loadFixtures(file);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("gone.nf");
    expect(message).toContain("maybe");
    expect(loadFixtures().fixtures.length).toBeGreaterThan(0);
    expect(existsSync(FIXTURES_FILE)).toBe(true);
  });

  it("F-005 ADR-0017: each fixture is one lint row named fixture:<file>, run on a single fresh copy with a lint.log", () => {
    const manifest = loadFixtures(makeFixtures());
    const fixturesDir = tmp();
    const calls: [readonly string[], string][] = [];
    const exec: Exec = (args, cwd) => {
      calls.push([args, cwd]);
      return cwd.endsWith("bad") ? res({ status: 1 }) : res();
    };
    const results = runFixtures(manifest, { exec, fixturesDir });
    expect(results.map((r) => [r.caseId, r.kind, r.matched])).toEqual([
      ["fixture:good.nf", "lint", true],
      ["fixture:bad.nf", "lint", true],
    ]);
    expect(calls[0]).toEqual([
      ["lint", "-o", "json", "."],
      join(fixturesDir, "good"),
    ]);
    expect(readFileSync(join(fixturesDir, "good", "good.nf"), "utf8")).toBe(
      "// ok\n",
    );
    expect(existsSync(join(fixturesDir, "good", "bad.nf"))).toBe(false);
    expect(existsSync(join(fixturesDir, "bad", "lint.log"))).toBe(true);
  });

  it("F-005 ADR-0017: a fixture whose lint result differs from fixtures.yaml fails the run, and --case skips fixtures", () => {
    const fixturesFile = makeFixtures();
    const manifestDir = tmp();
    mkdirSync(join(manifestDir, "c1"));
    writeFileSync(join(manifestDir, "c1", "main.nf"), "");
    const manifest = join(manifestDir, "cases.yaml");
    writeFileSync(
      manifest,
      "cases:\n  - id: c1\n    about: a\n    spec: [F-005]\n    sources: [u]\n    lint: { expect: ok }\n",
    );
    const exec: Exec = (args) =>
      args[0] === "-version" ? res({ stdout: "version 1.2.3 build 1" }) : res(); // bad.nf wrongly lints clean
    const deps = {
      pin: { version: "1.2.3", sha256: "a".repeat(64) },
      exec,
      env: {},
      write: () => {},
    };
    const cache = tmp();
    expect(
      main(["--manifest", manifest], {
        ...deps,
        fixturesFile,
        oracleCache: cache,
      }),
    ).toBe(1);
    const rows = (
      JSON.parse(readFileSync(join(cache, "results.json"), "utf8")) as {
        results: { caseId: string }[];
      }
    ).results.map((r) => r.caseId);
    expect(rows).toEqual(["c1", "fixture:good.nf", "fixture:bad.nf"]);
    const cache2 = tmp();
    expect(
      main(["--manifest", manifest, "--case", "c1"], {
        ...deps,
        fixturesFile,
        oracleCache: cache2,
      }),
    ).toBe(0);
  });
});

describe("F-005 default run and annotations", () => {
  it("F-005 ADR-0017: a plain pnpm oracle (no --case, no --manifest) includes the corpus fixtures", () => {
    const cache = tmp();
    main([], {
      pin: { version: "1.2.3", sha256: "a".repeat(64) },
      exec: (args) =>
        args[0] === "-version"
          ? res({ stdout: "version 1.2.3 build 1" })
          : res(),
      env: {},
      oracleCache: cache,
      write: () => {},
    });
    const rows = (
      JSON.parse(readFileSync(join(cache, "results.json"), "utf8")) as {
        results: { caseId: string }[];
      }
    ).results.map((r) => r.caseId);
    expect(rows.some((id) => id.startsWith("fixture:"))).toBe(true);
    expect(rows.some((id) => id.startsWith("s1-"))).toBe(true);
  });

  it("F-005 ADR-0017: annotations point fixture rows at fixtures.yaml and case rows at the cases manifest", () => {
    const row = (caseId: string) => ({
      ...evaluateLint({ expect: "ok", errors: [] }, res({ status: 1 })),
      caseId,
      kind: "lint" as const,
      command: [],
      expected: "ok" as const,
      exitCode: 1,
      durationMs: 1,
      logFile: "/nowhere",
    });
    const lines = annotations(
      {
        nextflowVersion: "1.2.3",
        manifest: `${REPO_ROOT}/tools/oracle/cases/cases.yaml`,
        startedAt: "now",
        results: [row("c1"), row("fixture:x.nf")],
      },
      REPO_ROOT,
    );
    expect(lines[0]).toContain("file=tools/oracle/cases/cases.yaml,");
    expect(lines[1]).toContain("file=tools/corpus/fixtures/fixtures.yaml,");
  });
});
