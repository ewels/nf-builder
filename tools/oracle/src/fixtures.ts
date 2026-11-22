import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { parse } from "yaml";
import type { Outcome } from "./cases.ts";
import { evaluateLint } from "./check.ts";
import type { Exec } from "./nextflow.ts";
import { FIXTURES_FILE, ORACLE_CACHE } from "./paths.ts";
import type { CheckResult } from "./run.ts";

export type Fixture = { file: string; path: string; lint: Outcome };
export type FixtureManifest = { file: string; fixtures: Fixture[] };

/** Reads only the `file` and `lint` keys of tools/corpus/fixtures/fixtures.yaml. Throws one Error listing every problem. */
export function loadFixtures(file: string = FIXTURES_FILE): FixtureManifest {
  const root: unknown = parse(readFileSync(file, "utf8"));
  const list = (root as { fixtures?: unknown } | null)?.fixtures;
  if (!Array.isArray(list))
    throw new Error(`${file}: "fixtures" must be a list`);
  const problems: string[] = [];
  const fixtures: Fixture[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const name = typeof raw?.file === "string" ? raw.file : "";
    const path = join(dirname(file), name);
    if (name === "" || !existsSync(path)) {
      problems.push(`${file}: fixture ${name || "?"}: file is missing`);
    }
    if (raw?.lint !== "ok" && raw?.lint !== "error") {
      problems.push(
        `${file}: fixture ${name || "?"}: lint must be ok or error, got ${JSON.stringify(raw?.lint)}`,
      );
      continue;
    }
    fixtures.push({ file: name, path, lint: raw.lint });
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return { file, fixtures };
}

export type FixtureRunOptions = {
  exec: Exec;
  fixturesDir?: string;
  log?: (line: string) => void;
};

/** Copies each fixture alone into <fixturesDir>/<stem>/ and runs `nextflow lint -o json .` there. */
export function runFixtures(
  manifest: FixtureManifest,
  options: FixtureRunOptions,
): CheckResult[] {
  const {
    exec,
    fixturesDir = join(ORACLE_CACHE, "fixtures"),
    log = () => {},
  } = options;
  return manifest.fixtures.map((fixture) => {
    const dir = join(
      fixturesDir,
      basename(fixture.file, extname(fixture.file)),
    );
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    copyFileSync(fixture.path, join(dir, fixture.file));
    const command = ["lint", "-o", "json", "."];
    log(`fixture:${fixture.file}: nextflow ${command.join(" ")}`);
    const result = exec(command, dir);
    const logFile = join(dir, "lint.log");
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
      ...evaluateLint({ expect: fixture.lint, errors: [] }, result),
      caseId: `fixture:${fixture.file}`,
      kind: "lint" as const,
      command,
      expected: fixture.lint,
      exitCode: result.status,
      durationMs: result.durationMs,
      logFile,
    };
  });
}
