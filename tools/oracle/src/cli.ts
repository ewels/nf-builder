import {
  appendFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadManifest, type Manifest } from "./cases.ts";
import { type FixtureManifest, loadFixtures, runFixtures } from "./fixtures.ts";
import {
  type FormatManifest,
  loadFormatManifest,
  runFormatTrees,
} from "./format.ts";
import {
  type Exec,
  ensureNextflow,
  nextflowEnv,
  nextflowExec,
} from "./nextflow.ts";
import {
  AST_ERRORS_FILE,
  AST_FIXTURES_FILE,
  CONFIG_AST_ERRORS_FILE,
  DEFAULT_MANIFEST,
  FIXTURES_FILE,
  FREE_VARIABLE_PROBES_FILE,
  LINT_FIXTURES_FILE,
  ORACLE_CACHE,
  PRINTER_FIXTURES_FILE,
  PROJECTION_FIXTURES_FILE,
  REPO_ROOT,
} from "./paths.ts";
import { loadPin, type NextflowPin } from "./pin.ts";
import { annotations, formatReport } from "./report.ts";
import { runOracle } from "./run.ts";
import { loadTreeManifest, runTree, type TreeManifest } from "./trees.ts";

export const USAGE =
  "Usage: pnpm oracle [--case <id>]... [--manifest <file>] [--write-format]";

export type OracleDeps = {
  pin?: NextflowPin;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
  oracleCache?: string;
  /** The fixtures manifest to lint. Default: tools/corpus/fixtures/fixtures.yaml, unless --manifest is given; --case always skips fixtures. */
  fixturesFile?: string;
  /** The trees to lint as one run each. Default: F-102's AST fixtures and error inputs, F-103's config errors, F-106's type probes and F-108's free-variable probes, on a plain run (no --case, no --manifest). */
  trees?: TreeManifest[];
  /** The printer fixture trees to format (`format` and `fixed-point` checks). Default: the pack's fixtures.json, on a plain run (no --case, no --manifest). */
  formatManifest?: FormatManifest;
  write?: (line: string) => void;
};

/** Exit codes: 0 all matched; 1 a mismatch; 2 usage, manifest or pin error; 3 Nextflow unobtainable or the wrong version. */
export function main(argv: readonly string[], deps: OracleDeps = {}): number {
  const write = deps.write ?? ((line: string) => console.log(line));
  const env = deps.env ?? process.env;
  const oracleCache = deps.oracleCache ?? ORACLE_CACHE;
  const args = argv[0] === "--" ? argv.slice(1) : argv;

  let values: {
    case?: string[];
    manifest?: string;
    "write-format"?: boolean;
  };
  try {
    values = parseArgs({
      args,
      strict: true,
      options: {
        case: { type: "string", multiple: true },
        manifest: { type: "string" },
        "write-format": { type: "boolean" },
      },
    }).values;
  } catch (error) {
    write(`oracle: ${(error as Error).message}`);
    write(USAGE);
    return 2;
  }

  const writeFormat = values["write-format"] === true;
  const fixturesFile =
    values.case !== undefined
      ? undefined
      : (deps.fixturesFile ??
        (values.manifest === undefined ? FIXTURES_FILE : undefined));

  let pin: NextflowPin;
  let manifest: Manifest;
  let fixtures: FixtureManifest | undefined;
  let trees: TreeManifest[];
  let formatManifest: FormatManifest | undefined;
  try {
    pin = deps.pin ?? loadPin();
    manifest = loadManifest(resolve(values.manifest ?? DEFAULT_MANIFEST));
    fixtures =
      fixturesFile === undefined ? undefined : loadFixtures(fixturesFile);
    trees =
      deps.trees ??
      (values.case === undefined && values.manifest === undefined
        ? [
            loadTreeManifest(AST_FIXTURES_FILE, "ast-fixtures"),
            loadTreeManifest(AST_ERRORS_FILE, "ast-errors"),
            loadTreeManifest(CONFIG_AST_ERRORS_FILE, "config-ast-errors"),
            loadTreeManifest(PROJECTION_FIXTURES_FILE, "projection-fixtures"),
            loadTreeManifest(FREE_VARIABLE_PROBES_FILE, "free-variable-probes"),
            ...(existsSync(LINT_FIXTURES_FILE)
              ? [loadTreeManifest(LINT_FIXTURES_FILE, "lint-fixtures")]
              : []),
          ]
        : []);
    const plain = values.case === undefined && values.manifest === undefined;
    formatManifest =
      deps.formatManifest ??
      (plain || writeFormat
        ? loadFormatManifest(PRINTER_FIXTURES_FILE)
        : undefined);
  } catch (error) {
    write((error as Error).message);
    return 2;
  }
  const wanted = values.case ?? [];
  const unknown = wanted.filter(
    (id) => !manifest.cases.some((c) => c.id === id),
  );
  if (unknown.length > 0) {
    write(`oracle: unknown case ${unknown.join(", ")}`);
    write(USAGE);
    return 2;
  }
  if (wanted.length > 0) {
    manifest = {
      ...manifest,
      cases: manifest.cases.filter((c) => wanted.includes(c.id)),
    };
  }

  let exec: Exec;
  try {
    exec =
      deps.exec ??
      nextflowExec(ensureNextflow(pin, { log: write }), nextflowEnv(env));
  } catch (error) {
    write(`oracle: ${(error as Error).message}`);
    return 3;
  }

  if (writeFormat) {
    const rows = runFormatTrees(formatManifest as FormatManifest, {
      exec,
      formatDir: `${oracleCache}/format`,
      write: true,
      log: write,
    });
    for (const r of rows) {
      write(`${r.matched ? "wrote   " : "MISMATCH"} ${r.caseId} ${r.kind}`);
      for (const problem of r.problems) write(`  ${problem}`);
    }
    return rows.every((r) => r.matched) ? 0 : 2;
  }

  let run: ReturnType<typeof runOracle>;
  try {
    run = runOracle(manifest, pin, {
      exec,
      runsDir: `${oracleCache}/runs`,
      log: write,
    });
  } catch (error) {
    write(`oracle: ${(error as Error).message}`);
    return 3;
  }
  if (fixtures !== undefined) {
    run.results.push(
      ...runFixtures(fixtures, {
        exec,
        fixturesDir: `${oracleCache}/fixtures`,
        log: write,
      }),
    );
  }
  for (const tree of trees)
    run.results.push(
      ...runTree(tree, { exec, cacheDir: oracleCache, log: write }),
    );
  if (formatManifest !== undefined && values.case === undefined) {
    run.results.push(
      ...runFormatTrees(formatManifest, {
        exec,
        formatDir: `${oracleCache}/format`,
        log: write,
      }),
    );
  }
  const report = formatReport(run);
  mkdirSync(oracleCache, { recursive: true });
  writeFileSync(`${oracleCache}/report.md`, report);
  writeFileSync(
    `${oracleCache}/results.json`,
    `${JSON.stringify(run, null, 2)}\n`,
  );
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report);
  if (env.GITHUB_ACTIONS === "true") {
    for (const line of annotations(run, REPO_ROOT)) write(line);
  }
  for (const r of run.results) {
    write(`${r.matched ? "ok      " : "MISMATCH"} ${r.caseId} ${r.kind}`);
  }
  return run.results.every((r) => r.matched) ? 0 : 1;
}

const isMain =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv.slice(2));
