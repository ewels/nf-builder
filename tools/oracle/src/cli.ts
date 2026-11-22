import {
  appendFileSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadManifest } from "./cases.ts";
import { loadFixtures, runFixtures } from "./fixtures.ts";
import {
  type Exec,
  ensureNextflow,
  nextflowEnv,
  nextflowExec,
} from "./nextflow.ts";
import {
  DEFAULT_MANIFEST,
  FIXTURES_FILE,
  ORACLE_CACHE,
  REPO_ROOT,
} from "./paths.ts";
import { loadPin, type NextflowPin } from "./pin.ts";
import { annotations, formatReport } from "./report.ts";
import { runOracle } from "./run.ts";

export const USAGE = "Usage: pnpm oracle [--case <id>]... [--manifest <file>]";

export type OracleDeps = {
  pin?: NextflowPin;
  ensure?: (pin: NextflowPin) => string;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
  oracleCache?: string;
  /** The fixtures manifest to lint. Default: tools/corpus/fixtures/fixtures.yaml, unless --manifest is given; --case always skips fixtures. */
  fixturesFile?: string;
  write?: (line: string) => void;
};

/** Exit codes: 0 all matched; 1 a mismatch; 2 usage, manifest or pin error; 3 Nextflow unobtainable or the wrong version. */
export function main(argv: readonly string[], deps: OracleDeps = {}): number {
  const write = deps.write ?? ((line: string) => console.log(line));
  const env = deps.env ?? process.env;
  const oracleCache = deps.oracleCache ?? ORACLE_CACHE;
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];

  let values: { case?: string[]; manifest?: string };
  try {
    values = parseArgs({
      args,
      strict: true,
      options: {
        case: { type: "string", multiple: true },
        manifest: { type: "string" },
      },
    }).values;
  } catch (error) {
    write(`oracle: ${(error as Error).message}`);
    write(USAGE);
    return 2;
  }

  const fixturesFile =
    values.case !== undefined
      ? undefined
      : (deps.fixturesFile ??
        (values.manifest === undefined ? FIXTURES_FILE : undefined));

  let pin: NextflowPin;
  let manifest: ReturnType<typeof loadManifest>;
  let fixtures: ReturnType<typeof loadFixtures> | undefined;
  try {
    pin = deps.pin ?? loadPin();
    manifest = loadManifest(resolve(values.manifest ?? DEFAULT_MANIFEST));
    fixtures =
      fixturesFile === undefined ? undefined : loadFixtures(fixturesFile);
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
      nextflowExec(
        deps.ensure?.(pin) ?? ensureNextflow(pin, { log: write }),
        nextflowEnv(env),
      );
  } catch (error) {
    write(`oracle: ${(error as Error).message}`);
    return 3;
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
  const bad = run.results.filter((r) => !r.matched);
  for (const r of run.results) {
    write(`${r.matched ? "ok      " : "MISMATCH"} ${r.caseId} ${r.kind}`);
  }
  return bad.length === 0 ? 0 : 1;
}

const isMain =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv.slice(2));
