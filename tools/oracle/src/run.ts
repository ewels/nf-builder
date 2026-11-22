import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, OracleCase, Outcome } from "./cases.ts";
import {
  type CheckKind,
  type Evaluation,
  evaluateLint,
  evaluateRun,
} from "./check.ts";
import { type Exec, type ExecResult, parseVersion } from "./nextflow.ts";
import { ORACLE_CACHE } from "./paths.ts";
import type { NextflowPin } from "./pin.ts";

export type CheckResult = Evaluation & {
  caseId: string;
  kind: CheckKind;
  command: string[];
  expected: Outcome;
  exitCode: number | null;
  durationMs: number;
  logFile: string;
};
export type RunOptions = {
  exec: Exec;
  runsDir?: string;
  log?: (line: string) => void;
};

/** rm -rf <runsDir>/<id>, then copies the case directory there. Returns the run directory. */
export function prepareRunDir(c: OracleCase, runsDir: string): string {
  const dir = join(runsDir, c.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(runsDir, { recursive: true });
  cpSync(c.dir, dir, { recursive: true });
  return dir;
}

const writeLog = (
  file: string,
  command: string[],
  result: ExecResult,
): void => {
  writeFileSync(
    file,
    [
      `$ nextflow ${command.join(" ")}`,
      `exit: ${result.status ?? `signal ${result.signal}`}`,
      `duration: ${result.durationMs} ms`,
      "--- stdout ---",
      result.stdout,
      "--- stderr ---",
      result.stderr,
      "",
    ].join("\n"),
  );
};

/** In the run directory: lint as ["lint", "-o", "json", "."], then run as ["run", script, ...args]. Writes lint.log and run.log. */
export function runCase(c: OracleCase, options: RunOptions): CheckResult[] {
  const {
    exec,
    runsDir = join(ORACLE_CACHE, "runs"),
    log = () => {},
  } = options;
  const dir = prepareRunDir(c, runsDir);
  const results: CheckResult[] = [];
  const record = (
    kind: CheckKind,
    command: string[],
    expected: Outcome,
    evaluate: (result: ExecResult) => Evaluation,
  ): void => {
    log(`${c.id}: nextflow ${command.join(" ")}`);
    const result = exec(command, dir);
    const logFile = join(dir, `${kind}.log`);
    writeLog(logFile, command, result);
    results.push({
      ...evaluate(result),
      caseId: c.id,
      kind,
      command,
      expected,
      exitCode: result.status,
      durationMs: result.durationMs,
      logFile,
    });
  };
  const { lint, run } = c;
  if (lint) {
    record("lint", ["lint", "-o", "json", "."], lint.expect, (r) =>
      evaluateLint(lint, r),
    );
  }
  if (run) {
    record("run", ["run", run.script, ...run.args], run.expect, (r) =>
      evaluateRun(run, r),
    );
  }
  return results;
}

export type OracleRun = {
  nextflowVersion: string;
  manifest: string;
  startedAt: string;
  results: CheckResult[];
};

/** Runs ["-version"] first; throws if it isn't the pinned version. Then runs every case in order. */
export function runOracle(
  manifest: Manifest,
  pin: NextflowPin,
  options: RunOptions,
): OracleRun {
  const startedAt = new Date().toISOString();
  const probe = options.exec(["-version"], process.cwd());
  const actual = parseVersion(`${probe.stdout}\n${probe.stderr}`);
  if (actual !== pin.version) {
    throw new Error(
      `expected Nextflow ${pin.version}, got ${actual ?? "no version"}`,
    );
  }
  const results = manifest.cases.flatMap((c) => runCase(c, options));
  return {
    nextflowVersion: actual,
    manifest: manifest.file,
    startedAt,
    results,
  };
}
