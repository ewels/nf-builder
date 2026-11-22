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
import type { NextflowPin } from "./pin.ts";

export const LINT_COMMAND = ["lint", "-o", "json", "."];

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
  runsDir: string;
  log?: (line: string) => void;
};

/** Runs one nextflow command in dir, writes <kind>.log there and evaluates the result. */
export function runCheck(
  exec: Exec,
  dir: string,
  caseId: string,
  kind: CheckKind,
  command: string[],
  expected: Outcome,
  evaluate: (result: ExecResult) => Evaluation,
): CheckResult {
  const result = exec(command, dir);
  const logFile = join(dir, `${kind}.log`);
  writeFileSync(
    logFile,
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
  return {
    ...evaluate(result),
    caseId,
    kind,
    command,
    expected,
    exitCode: result.status,
    durationMs: result.durationMs,
    logFile,
  };
}

/** In a fresh copy of the case: lint, then run. Writes lint.log and run.log. */
export function runCase(c: OracleCase, options: RunOptions): CheckResult[] {
  const { exec, runsDir, log = () => {} } = options;
  const dir = join(runsDir, c.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(runsDir, { recursive: true });
  cpSync(c.dir, dir, { recursive: true });
  const { lint, run } = c;
  const results: CheckResult[] = [];
  if (lint) {
    log(`${c.id}: nextflow ${LINT_COMMAND.join(" ")}`);
    results.push(
      runCheck(exec, dir, c.id, "lint", LINT_COMMAND, lint.expect, (r) =>
        evaluateLint(lint, r),
      ),
    );
  }
  if (run) {
    const command = ["run", run.script, ...run.args];
    log(`${c.id}: nextflow ${command.join(" ")}`);
    results.push(
      runCheck(exec, dir, c.id, "run", command, run.expect, (r) =>
        evaluateRun(run, r),
      ),
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
