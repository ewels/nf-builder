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
import { main } from "../src/cli.ts";
import type { Exec, ExecResult } from "../src/nextflow.ts";
import {
  AST_ERRORS_FILE,
  AST_FIXTURES_FILE,
  CONFIG_AST_ERRORS_FILE,
  PROJECTION_FIXTURES_FILE,
} from "../src/paths.ts";
import { loadTreeManifest, runTree } from "../src/trees.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "oracle-tree-"));
const lintJson = (
  errors: {
    filename: string;
    startLine: number;
    startColumn: number;
    message: string;
  }[],
): ExecResult => ({
  status: errors.length > 0 ? 1 : 0,
  signal: null,
  stdout: JSON.stringify({ errors, warnings: [] }, null, 2),
  stderr: "",
  durationMs: 1,
});

/** A pack directory with `fixtures.json` and `fixtures/` (a nested module too), as F-102's. */
const makePack = (
  lint: Record<string, { line: number; column: number; message: string }[]>,
) => {
  const pack = tmp();
  mkdirSync(join(pack, "fixtures", "modules", "x"), { recursive: true });
  const files = ["a.nf", "modules/x/main.nf"];
  for (const f of files) writeFileSync(join(pack, "fixtures", f), `// ${f}\n`);
  const manifest = join(pack, "fixtures.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      fixtures: files.map((file) => ({ file, lint: lint[file] ?? [] })),
    }),
  );
  return manifest;
};

describe("F-102 trees", () => {
  it("F-102 ADR-0019: the oracle lints the AST fixtures as one tree and expects no errors", () => {
    const manifest = loadTreeManifest(makePack({}), "ast-fixtures");
    const cache = tmp();
    const calls: [readonly string[], string][] = [];
    const exec: Exec = (args, cwd) => {
      calls.push([args, cwd]);
      return lintJson([]);
    };
    const results = runTree(manifest, { exec, cacheDir: cache });
    expect(calls).toEqual([
      [["lint", "-o", "json", "."], join(cache, "trees", "ast-fixtures")],
    ]);
    expect(
      results.map((r) => [r.caseId, r.kind, r.expected, r.matched]),
    ).toEqual([
      ["ast-fixtures:a.nf", "lint", "ok", true],
      ["ast-fixtures:modules/x/main.nf", "lint", "ok", true],
    ]);
    // relative paths are kept: the module sits where its includes expect it
    expect(
      readFileSync(
        join(cache, "trees", "ast-fixtures", "modules/x/main.nf"),
        "utf8",
      ),
    ).toBe("// modules/x/main.nf\n");
    expect(existsSync(join(cache, "trees", "ast-fixtures", "lint.log"))).toBe(
      true,
    );
  });

  it("F-102 ADR-0019: an AST error input whose lint errors differ is a mismatch naming the file", () => {
    const recorded = {
      line: 2,
      column: 5,
      message: "Invalid process directive",
    };
    const manifest = loadTreeManifest(
      makePack({ "a.nf": [recorded] }),
      "ast-errors",
    );
    // lint reports the right error for a.nf but a new one in the module
    const exec: Exec = () =>
      lintJson([
        {
          filename: "a.nf",
          startLine: 2,
          startColumn: 5,
          message: "Invalid process directive",
        },
        {
          filename: "modules/x/main.nf",
          startLine: 1,
          startColumn: 1,
          message: "Surprise",
        },
      ]);
    const results = runTree(manifest, { exec, cacheDir: tmp() });
    expect(results.map((r) => [r.caseId, r.matched])).toEqual([
      ["ast-errors:a.nf", true],
      ["ast-errors:modules/x/main.nf", false],
    ]);
    expect(results[1]?.problems[0]).toContain("modules/x/main.nf");
    expect(results[1]?.problems[0]).toContain("Surprise");

    const wrongPosition: Exec = () =>
      lintJson([
        {
          filename: "a.nf",
          startLine: 3,
          startColumn: 5,
          message: recorded.message,
        },
      ]);
    const moved = runTree(manifest, { exec: wrongPosition, cacheDir: tmp() });
    expect(moved[0]?.matched).toBe(false);
    expect(moved[0]?.problems[0]).toContain(
      "a.nf: expected 2:5 Invalid process directive; lint reported 3:5",
    );

    const noJson: Exec = () => ({ ...lintJson([]), status: 3, stdout: "boom" });
    expect(
      runTree(manifest, { exec: noJson, cacheDir: tmp() }).every(
        (r) => !r.matched,
      ),
    ).toBe(true);
  });

  it("F-102 ADR-0019: the pack's fixtures.json and errors.json load, and every file they name exists", () => {
    for (const [file, name] of [
      [AST_FIXTURES_FILE, "ast-fixtures"],
      [AST_ERRORS_FILE, "ast-errors"],
    ] as const) {
      const manifest = loadTreeManifest(file, name);
      expect(manifest.files.length).toBeGreaterThan(40);
      for (const f of manifest.files)
        expect(existsSync(join(manifest.dir, f.file)), f.file).toBe(true);
    }
    expect(
      loadTreeManifest(AST_FIXTURES_FILE, "x").files.every(
        (f) => f.lint.length === 0,
      ),
    ).toBe(true);
    expect(
      loadTreeManifest(AST_ERRORS_FILE, "x").files.every(
        (f) => f.lint.length > 0,
      ),
    ).toBe(true);
  });

  it("F-102 ADR-0019: a plain pnpm oracle lints both AST trees after the cases and the corpus fixtures", () => {
    const cache = tmp();
    main([], {
      pin: { version: "1.2.3", sha256: "a".repeat(64) },
      exec: (args) =>
        args[0] === "-version"
          ? { ...lintJson([]), stdout: "version 1.2.3 build 1" }
          : lintJson([]),
      env: {},
      oracleCache: cache,
      write: () => {},
    });
    const rows = (
      JSON.parse(readFileSync(join(cache, "results.json"), "utf8")) as {
        results: { caseId: string; matched: boolean }[];
      }
    ).results;
    expect(
      rows.some((r) => r.caseId.startsWith("ast-fixtures:process-typed.nf")),
    ).toBe(true);
    // a fake that finds no errors cannot match the error inputs
    expect(
      rows.filter((r) => r.caseId.startsWith("ast-errors:") && !r.matched)
        .length,
    ).toBeGreaterThan(40);
  });

  it("F-103 ADR-0019: the config error tree loads, every file exists, and a plain oracle run checks it with positions", () => {
    const manifest = loadTreeManifest(
      CONFIG_AST_ERRORS_FILE,
      "config-ast-errors",
    );
    expect(manifest.files.length).toBeGreaterThan(20);
    for (const f of manifest.files) {
      expect(existsSync(join(manifest.dir, f.file)), f.file).toBe(true);
      expect(f.lint.length, f.file).toBeGreaterThan(0);
    }
    const cache = tmp();
    main([], {
      pin: { version: "1.2.3", sha256: "a".repeat(64) },
      exec: (args) =>
        args[0] === "-version"
          ? { ...lintJson([]), stdout: "version 1.2.3 build 1" }
          : lintJson([]),
      env: {},
      oracleCache: cache,
      write: () => {},
    });
    const rows = (
      JSON.parse(readFileSync(join(cache, "results.json"), "utf8")) as {
        results: { caseId: string; matched: boolean }[];
      }
    ).results;
    expect(
      rows.filter(
        (r) => r.caseId.startsWith("config-ast-errors:") && !r.matched,
      ).length,
    ).toBe(manifest.files.length);
  });
  it("F-106 ADR-0019: the projection type-probe tree loads, every file exists, and a plain oracle run checks it with positions", () => {
    const manifest = loadTreeManifest(
      PROJECTION_FIXTURES_FILE,
      "projection-fixtures",
    );
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const f of manifest.files) {
      expect(existsSync(join(manifest.dir, f.file)), f.file).toBe(true);
      expect(f.lint.length, f.file).toBeGreaterThan(0);
    }
    const cache = tmp();
    main([], {
      pin: { version: "1.2.3", sha256: "a".repeat(64) },
      exec: (args) =>
        args[0] === "-version"
          ? { ...lintJson([]), stdout: "version 1.2.3 build 1" }
          : lintJson([]),
      env: {},
      oracleCache: cache,
      write: () => {},
    });
    const rows = (
      JSON.parse(readFileSync(join(cache, "results.json"), "utf8")) as {
        results: { caseId: string; matched: boolean }[];
      }
    ).results;
    // a fake that finds no errors cannot match the probe messages
    expect(
      rows.filter(
        (r) => r.caseId.startsWith("projection-fixtures:") && !r.matched,
      ).length,
    ).toBe(manifest.files.length);
  });
});
