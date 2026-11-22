import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifest } from "../src/cases.ts";
import { parseFormatJson } from "../src/check.ts";
import { main } from "../src/cli.ts";
import {
  type FormatManifest,
  loadFormatManifest,
  runFormatTrees,
} from "../src/format.ts";
import type { Exec, ExecResult } from "../src/nextflow.ts";
import { DEFAULT_MANIFEST, PRINTER_FIXTURES_FILE } from "../src/paths.ts";
import { annotations } from "../src/report.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "oracle-format-"));
const put = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const report = (
  filesFormatted: number,
  errors: { filename: string; message: string }[] = [],
  status = errors.length > 0 ? 1 : 0,
): ExecResult => ({
  status,
  signal: null,
  stdout: JSON.stringify(
    {
      summary: { errors: errors.length, filesFormatted },
      errors: errors.map((e) => ({ ...e, startLine: 2, startColumn: 3 })),
      warnings: [],
    },
    null,
    2,
  ),
  stderr: "",
  durationMs: 1,
});

/** A pack directory: manifest, `input/a.nf`, `formatted/a.nf` and an empty `printed/`. */
const makePack = (
  inputText = "a  =  1\n",
  formattedText = "a = 1\n",
): { file: string; dir: string; manifest: FormatManifest } => {
  const dir = tmp();
  put(join(dir, "input", "a.nf"), inputText);
  put(join(dir, "input", "lib", "b.nf"), "b = 2\n");
  put(join(dir, "formatted", "a.nf"), formattedText);
  put(join(dir, "formatted", "lib", "b.nf"), "b = 2\n");
  mkdirSync(join(dir, "printed"));
  const file = join(dir, "fixtures.json");
  writeFileSync(
    file,
    JSON.stringify({
      trees: [
        {
          name: "t",
          input: "input",
          formatted: "formatted",
          printed: "printed",
        },
      ],
      knownDifferences: { bug: "an upstream bug" },
      files: [
        { tree: "t", path: "a.nf", kind: "parsed" },
        { tree: "t", path: "lib/b.nf", kind: "support" },
      ],
    }),
  );
  return { file, dir, manifest: loadFormatManifest(file) };
};

/** Formats in place like Nextflow: the file in the cwd named by `rewrites` gets the new text. */
const fakeFormat =
  (
    perDir: Record<
      string,
      { rewrites: Record<string, string>; result: ExecResult }
    >,
    calls: [readonly string[], string][] = [],
  ): Exec =>
  (args, cwd) => {
    calls.push([args, cwd]);
    const key = cwd.endsWith("input") ? "input" : "expected";
    const plan = perDir[key];
    if (plan === undefined) throw new Error(`unexpected cwd ${cwd}`);
    for (const [path, text] of Object.entries(plan.rewrites))
      writeFileSync(join(cwd, path), text);
    return plan.result;
  };

describe("F-110 format trees", () => {
  it("F-110 step 1 ADR-0019: the oracle formats each printer tree's input and its composed expected tree and reports no difference", () => {
    const { manifest } = makePack();
    const cache = tmp();
    const calls: [readonly string[], string][] = [];
    const exec = fakeFormat(
      {
        input: { rewrites: { "a.nf": "a = 1\n" }, result: report(1) },
        expected: { rewrites: {}, result: report(0) },
      },
      calls,
    );
    const rows = runFormatTrees(manifest, { exec, formatDir: cache });
    expect(calls).toEqual([
      [["lint", "-format", "-o", "json", "."], join(cache, "t", "input")],
      [["lint", "-format", "-o", "json", "."], join(cache, "t", "expected")],
    ]);
    expect(rows.map((r) => [r.caseId, r.kind, r.matched])).toEqual([
      ["printer:t", "format", true],
      ["printer:t", "fixed-point", true],
    ]);
    // the expected tree is the input with formatted/ laid over it
    expect(readFileSync(join(cache, "t", "expected", "a.nf"), "utf8")).toBe(
      "a = 1\n",
    );
  });

  it("F-110 step 1: a formatted input that differs from formatted/ is a mismatch naming the file and first differing line", () => {
    const { manifest } = makePack("a  =  1\n", "a = 1\nb = 3\n");
    const exec = fakeFormat({
      input: { rewrites: { "a.nf": "a = 1\nb = 2\n" }, result: report(1) },
      expected: { rewrites: {}, result: report(0) },
    });
    const [format] = runFormatTrees(manifest, { exec, formatDir: tmp() });
    expect(format?.matched).toBe(false);
    expect(format?.problems[0]).toContain("a.nf");
    expect(format?.problems[0]).toContain("line 2");
    const log = readFileSync(format?.logFile ?? "", "utf8");
    expect(log).toContain("--- expected/a.nf");
    expect(log).toContain("-b = 3");
    expect(log).toContain("+b = 2");
  });

  it("F-110 step 1: an expected file that Nextflow reformats is a fixed-point mismatch", () => {
    for (const rewrites of [{ "a.nf": "a  = 1\n" }, {}] as Record<
      string,
      string
    >[]) {
      const { manifest } = makePack();
      const exec = fakeFormat({
        input: { rewrites: { "a.nf": "a = 1\n" }, result: report(1) },
        expected: { rewrites, result: report(1) },
      });
      const rows = runFormatTrees(manifest, { exec, formatDir: tmp() });
      expect(rows[0]?.matched).toBe(true);
      expect(rows[1]?.kind).toBe("fixed-point");
      expect(rows[1]?.matched).toBe(false);
    }
  });

  it("F-110 step 2: an expected file with a lint error is a fixed-point mismatch", () => {
    const { manifest } = makePack();
    const exec = fakeFormat({
      input: { rewrites: { "a.nf": "a = 1\n" }, result: report(1) },
      expected: {
        rewrites: {},
        result: report(0, [{ filename: "a.nf", message: "X is not defined" }]),
      },
    });
    const rows = runFormatTrees(manifest, { exec, formatDir: tmp() });
    expect(rows[1]?.matched).toBe(false);
    expect(rows[1]?.problems.join("\n")).toContain("X is not defined");
    expect(rows[1]?.errors).toEqual(["X is not defined"]);
  });

  it("F-110 step 1 ADR-0005: lint -format may rewrite a file with a known difference in the fixed-point run, and no other", () => {
    const run = (known: boolean, rewrites: Record<string, string>) => {
      const { manifest } = makePack();
      if (known)
        manifest.files[0] = {
          ...(manifest.files[0] as FormatManifest["files"][number]),
          knownDifference: "bug",
        };
      const exec = fakeFormat({
        input: { rewrites: { "a.nf": "a = 1\n" }, result: report(1) },
        expected: { rewrites, result: report(Object.keys(rewrites).length) },
      });
      return runFormatTrees(manifest, { exec, formatDir: tmp() })[1];
    };
    expect(run(true, { "a.nf": "a  = 1\n" })?.matched).toBe(true);
    expect(run(false, { "a.nf": "a  = 1\n" })?.matched).toBe(false);
    // the allowance is for the files named, not for more
    expect(
      run(true, { "a.nf": "a  = 1\n", "lib/b.nf": "b  = 2\n" })?.matched,
    ).toBe(false);
  });

  it("F-110 step 2: printed/ files are laid over formatted/ in the expected tree", () => {
    const { dir, manifest } = makePack();
    put(join(dir, "printed", "a.nf"), "a = 1  // ours\n");
    const cache = tmp();
    const exec = fakeFormat({
      input: { rewrites: { "a.nf": "a = 1\n" }, result: report(1) },
      expected: { rewrites: {}, result: report(0) },
    });
    const rows = runFormatTrees(manifest, { exec, formatDir: cache });
    expect(rows.every((r) => r.matched)).toBe(true);
    expect(readFileSync(join(cache, "t", "expected", "a.nf"), "utf8")).toBe(
      "a = 1  // ours\n",
    );
  });

  it("F-110: a printer fixture input with lint errors is a format mismatch, and --write-format refuses to write", () => {
    const { dir, manifest } = makePack();
    writeFileSync(join(dir, "formatted", "a.nf"), "stale\n");
    const exec = fakeFormat({
      input: {
        rewrites: {},
        result: report(0, [{ filename: "a.nf", message: "bad input" }]),
      },
      expected: { rewrites: {}, result: report(0) },
    });
    const rows = runFormatTrees(manifest, { exec, formatDir: tmp() });
    expect(rows[0]?.matched).toBe(false);
    expect(rows[0]?.problems.join("\n")).toContain("bad input");
    const lines: string[] = [];
    const code = main(["--write-format"], {
      formatManifest: manifest,
      exec,
      env: {},
      oracleCache: tmp(),
      pin: { version: "1.2.3", sha256: "a".repeat(64) },
      write: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(readFileSync(join(dir, "formatted", "a.nf"), "utf8")).toBe(
      "stale\n",
    );
  });

  it("F-110: --write-format rewrites formatted/ from Nextflow's output", () => {
    const { dir, manifest } = makePack("a  =  1\n", "stale\n");
    put(join(dir, "printed", "keep.nf"), "keep\n");
    const exec = fakeFormat({
      input: { rewrites: { "a.nf": "a = 1\n" }, result: report(1) },
    });
    const code = main(["--write-format"], {
      formatManifest: manifest,
      exec,
      env: {},
      oracleCache: tmp(),
      pin: { version: "1.2.3", sha256: "a".repeat(64) },
      write: () => {},
    });
    expect(code).toBe(0);
    expect(readFileSync(join(dir, "formatted", "a.nf"), "utf8")).toBe(
      "a = 1\n",
    );
    expect(readFileSync(join(dir, "formatted", "lib", "b.nf"), "utf8")).toBe(
      "b = 2\n",
    );
    expect(readFileSync(join(dir, "printed", "keep.nf"), "utf8")).toBe(
      "keep\n",
    );
    expect(readFileSync(join(dir, "input", "a.nf"), "utf8")).toBe("a  =  1\n");
  });

  it("F-110: the format manifest loader reports every problem at once", () => {
    const dir = tmp();
    put(join(dir, "input", "a.nf"), "a = 1\n");
    const file = join(dir, "fixtures.json");
    writeFileSync(
      file,
      JSON.stringify({
        surprise: true,
        trees: [
          { name: "t", input: "input", formatted: "f", printed: "p" },
          { name: "gone", input: "nowhere", formatted: "f", printed: "p" },
        ],
        knownDifferences: { bug: "x" },
        files: [
          { tree: "t", path: "a.nf", kind: "parsed", extra: 1 },
          { tree: "t", path: "missing.nf", kind: "parsed" },
          { tree: "t", path: "a.nf", kind: "parsed", knownDifference: "nope" },
          { tree: "t", path: "a.nf", kind: "support", knownDifference: "bug" },
        ],
      }),
    );
    let message = "";
    try {
      loadFormatManifest(file);
    } catch (error) {
      message = (error as Error).message;
    }
    for (const part of [
      'unknown key "surprise"',
      "tree gone: input directory",
      't/a.nf: unknown key "extra"',
      "t/missing.nf: a parsed file needs an input file",
      'knownDifference "nope" is not in knownDifferences',
      "only a parsed file can have a knownDifference",
    ])
      expect(message, part).toContain(part);
  });

  it("F-110: the pack's printer fixtures.json loads, and the ast tree names every file of F-102's fixtures", () => {
    const manifest = loadFormatManifest(PRINTER_FIXTURES_FILE);
    expect(manifest.trees.map((t) => t.name)).toEqual(["printer", "ast"]);
    expect(manifest.files.filter((f) => f.tree === "ast")).toHaveLength(56);
  });

  it("F-110 ADR-0019: pnpm oracle runs the printer trees by default and --case skips them", () => {
    const { manifest } = makePack();
    const run = (argv: string[]): string[] => {
      const cache = tmp();
      main(argv, {
        pin: { version: "1.2.3", sha256: "a".repeat(64) },
        exec: (args, cwd) => {
          if (args[0] === "-version")
            return { ...report(0), stdout: "version 1.2.3 build 1" };
          if (args.includes("-format"))
            return fakeFormat({
              input: { rewrites: { "a.nf": "a = 1\n" }, result: report(1) },
              expected: { rewrites: {}, result: report(0) },
            })(args, cwd);
          return report(0);
        },
        env: {},
        oracleCache: cache,
        formatManifest: manifest,
        fixturesFile: undefined,
        trees: [],
        write: () => {},
      });
      const rows = (
        JSON.parse(readFileSync(join(cache, "results.json"), "utf8")) as {
          results: { caseId: string; kind: string }[];
        }
      ).results;
      return rows.map((r) => `${r.caseId} ${r.kind}`);
    };
    expect(run([])).toEqual(
      expect.arrayContaining(["printer:t format", "printer:t fixed-point"]),
    );
    const id = loadManifest(DEFAULT_MANIFEST).cases[0]?.id ?? "";
    expect(id).not.toBe("");
    expect(run(["--case", id]).some((r) => r.startsWith("printer:"))).toBe(
      false,
    );
  });

  it("F-110: printer rows are annotated at the printer fixtures manifest", () => {
    const lines = annotations(
      {
        nextflowVersion: "1",
        manifest: "cases.yaml",
        startedAt: "",
        results: [
          {
            caseId: "printer:ast",
            kind: "format",
            matched: false,
            problems: ["x.nf: differs"],
          } as never,
        ],
      },
      "/repo",
    );
    expect(lines[0]).toContain("file=");
    expect(lines[0]).toContain("test/printer/fixtures.json");
  });

  it("F-110: parseFormatJson reads the summary and errors, and returns null without them", () => {
    const text = `date\n${report(2, [{ filename: "a.nf", message: "m" }]).stdout}`;
    expect(parseFormatJson(text)).toEqual({
      summary: { errors: 1, filesFormatted: 2 },
      errors: [
        { filename: "a.nf", message: "m", startLine: 2, startColumn: 3 },
      ],
    });
    expect(parseFormatJson("no json")).toBeNull();
    expect(parseFormatJson('{\n"errors": []\n}')).toBeNull();
  });
});
