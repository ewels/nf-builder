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
import type { OracleCase } from "../src/cases.ts";
import { main, USAGE } from "../src/cli.ts";
import type { Exec, ExecResult } from "../src/nextflow.ts";
import { runCase } from "../src/run.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "oracle-run-"));
const pin = { version: "1.2.3", sha256: "a".repeat(64) };
const res = (over: Partial<ExecResult> = {}): ExecResult => ({
  status: 0,
  signal: null,
  stdout: "",
  stderr: "",
  durationMs: 1,
  ...over,
});
const LINT_OK = JSON.stringify({ errors: [], warnings: [] });

const makeManifest = (ids: string[]): string => {
  const dir = tmp();
  const entries = ids.map((id) => {
    mkdirSync(join(dir, id));
    writeFileSync(join(dir, id, "main.nf"), "");
    return `  - id: ${id}
    about: a
    spec: [F-005]
    sources: [u]
    lint: { expect: ok }
    run: { expect: ok, output: ["hello"] }
`;
  });
  const file = join(dir, "cases.yaml");
  writeFileSync(file, `cases:\n${entries.join("")}`);
  return file;
};

const versionOr =
  (inner: Exec): Exec =>
  (args, cwd) =>
    args[0] === "-version"
      ? res({ stdout: `      version ${pin.version} build 1\n` })
      : inner(args, cwd);

describe("F-005 runner", () => {
  it("F-005: runCase runs lint -o json . then run <script> -stub in a fresh copy under .cache/oracle/runs/<id> and writes lint.log and run.log", () => {
    const manifestFile = makeManifest(["c1"]);
    const caseDir = join(manifestFile, "..", "c1");
    const c: OracleCase = {
      id: "c1",
      dir: caseDir,
      about: "a",
      spec: ["F-005"],
      sources: ["u"],
      lint: { expect: "ok", errors: [] },
      run: {
        expect: "ok",
        output: ["hello"],
        script: "main.nf",
        args: ["-stub"],
      },
    };
    const runsDir = tmp();
    mkdirSync(join(runsDir, "c1"));
    writeFileSync(join(runsDir, "c1", "stale.txt"), "x");
    const calls: [readonly string[], string][] = [];
    const exec: Exec = (args, cwd) => {
      calls.push([args, cwd]);
      return args[0] === "lint"
        ? res({ stdout: LINT_OK })
        : res({ stdout: "hello world" });
    };
    const results = runCase(c, { exec, runsDir });
    const runDir = join(runsDir, "c1");
    expect(calls).toEqual([
      [["lint", "-o", "json", "."], runDir],
      [["run", "main.nf", "-stub"], runDir],
    ]);
    expect(existsSync(join(runDir, "stale.txt"))).toBe(false);
    expect(results.map((r) => r.matched)).toEqual([true, true]);
    const log = readFileSync(join(runDir, "run.log"), "utf8");
    expect(log).toContain("run main.nf -stub");
    expect(log).toContain("hello world");
    expect(log).toMatch(/exit/i);
    expect(existsSync(join(runDir, "lint.log"))).toBe(true);
  });

  it("F-005 LA-03: the oracle stops before any case when nextflow -version doesn't report the pinned version", () => {
    const manifest = makeManifest(["c1"]);
    const cache = tmp();
    const seen: string[] = [];
    const code = main(["--manifest", manifest], {
      pin,
      ensure: () => "/dist",
      exec: (args) => {
        seen.push(args[0] ?? "");
        return res({ stdout: "      version 9.9.9 build 1\n" });
      },
      env: {},
      oracleCache: cache,
      write: () => {},
    });
    expect(code).toBe(3);
    expect(seen).toEqual(["-version"]);
  });

  it("F-005 ADR-0019: pnpm oracle exits 1 on any mismatch, still writes report.md and results.json with the actual outcomes, and prints one GitHub annotation per mismatch under Actions", () => {
    const manifest = makeManifest(["c1", "c2"]);
    const cache = tmp();
    const summary = join(tmp(), "summary.md");
    const lines: string[] = [];
    const exec = versionOr((args, cwd) => {
      if (args[0] === "lint") return res({ stdout: LINT_OK });
      return res({ stdout: cwd.endsWith("c1") ? "hello" : "nope" });
    });
    const code = main(["--", "--manifest", manifest], {
      pin,
      ensure: () => "/dist",
      exec,
      env: { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summary },
      oracleCache: cache,
      write: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    const results = JSON.parse(
      readFileSync(join(cache, "results.json"), "utf8"),
    ) as { results: { actual: string; matched: boolean }[] };
    expect(results.results).toHaveLength(4);
    expect(results.results.every((r) => r.actual === "ok")).toBe(true);
    const report = readFileSync(join(cache, "report.md"), "utf8");
    expect(report.split("\n").filter((l) => /^\| c[12] /.test(l))).toHaveLength(
      4,
    );
    expect(readFileSync(summary, "utf8")).toBe(report);
    const annotations = lines.filter((l) => l.startsWith("::error"));
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toContain("Nextflow oracle");
    expect(annotations[0]).toContain("c2 run");
  });

  it("F-005: --case selects cases by id, and an unknown id is a usage error", () => {
    const manifest = makeManifest(["c1", "c2"]);
    const cache = tmp();
    const ran: string[] = [];
    const deps = {
      pin,
      ensure: () => "/dist",
      exec: versionOr((args, cwd) => {
        if (args[0] === "run") ran.push(cwd);
        return args[0] === "lint"
          ? res({ stdout: LINT_OK })
          : res({ stdout: "hello" });
      }),
      env: {},
      oracleCache: cache,
    };
    const out: string[] = [];
    expect(
      main(["--manifest", manifest, "--case", "c2"], {
        ...deps,
        write: (l) => out.push(l),
      }),
    ).toBe(0);
    expect(ran).toHaveLength(1);
    const err: string[] = [];
    expect(
      main(["--manifest", manifest, "--case", "nope"], {
        ...deps,
        write: (l) => err.push(l),
      }),
    ).toBe(2);
    expect(err.join("\n")).toContain(USAGE);
  });
});
