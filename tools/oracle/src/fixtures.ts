import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { parse } from "yaml";
import { isRecord, type Outcome } from "./cases.ts";
import { evaluateLint } from "./check.ts";
import type { Exec } from "./nextflow.ts";
import { FIXTURES_FILE } from "./paths.ts";
import { type CheckResult, LINT_COMMAND, runCheck } from "./run.ts";

export type Fixture = { file: string; path: string; lint: Outcome };
export type FixtureManifest = { file: string; fixtures: Fixture[] };

/** Reads only the `file` and `lint` keys of tools/corpus/fixtures/fixtures.yaml. Throws one Error listing every problem. */
export function loadFixtures(file: string = FIXTURES_FILE): FixtureManifest {
  const root: unknown = parse(readFileSync(file, "utf8"));
  const list = isRecord(root) ? root.fixtures : undefined;
  if (!Array.isArray(list))
    throw new Error(`${file}: "fixtures" must be a list`);
  const problems: string[] = [];
  const fixtures: Fixture[] = [];
  for (const entry of list) {
    const raw = isRecord(entry) ? entry : {};
    const name = typeof raw.file === "string" ? raw.file : "";
    const path = join(dirname(file), name);
    if (name === "" || !existsSync(path)) {
      problems.push(`${file}: fixture ${name || "?"}: file is missing`);
    }
    if (raw.lint !== "ok" && raw.lint !== "error") {
      problems.push(
        `${file}: fixture ${name || "?"}: lint must be ok or error, got ${JSON.stringify(raw.lint)}`,
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
  fixturesDir: string;
  log?: (line: string) => void;
};

/** Copies each fixture alone into <fixturesDir>/<stem>/ and lints it there. */
export function runFixtures(
  manifest: FixtureManifest,
  options: FixtureRunOptions,
): CheckResult[] {
  const { exec, fixturesDir, log = () => {} } = options;
  return manifest.fixtures.map((fixture) => {
    const dir = join(
      fixturesDir,
      basename(fixture.file, extname(fixture.file)),
    );
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    copyFileSync(fixture.path, join(dir, fixture.file));
    log(`fixture:${fixture.file}: nextflow ${LINT_COMMAND.join(" ")}`);
    return runCheck(
      exec,
      dir,
      `fixture:${fixture.file}`,
      "lint",
      LINT_COMMAND,
      fixture.lint,
      (r) => evaluateLint({ expect: fixture.lint, errors: [] }, r),
    );
  });
}
