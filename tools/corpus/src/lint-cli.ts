import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { isUpToDate } from "./fetch.ts";
import { FIXTURES_DIR } from "./fixtures.ts";
import { lintCorpus, resolveLauncher, UPSTREAM_FILE } from "./lint.ts";
import { DEFAULT_CACHE_DIR, loadManifest } from "./manifest.ts";

const USAGE = "Usage: pnpm corpus:lint [--nextflow <launcher>] [--force]";

/** Returns the exit code: 0 done, 1 lint could not run, 2 usage or missing input. */
function main(argv: string[]): number {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let values: { nextflow?: string; force?: boolean; upstream?: string };
  try {
    values = parseArgs({
      args,
      strict: true,
      options: {
        nextflow: { type: "string" },
        force: { type: "boolean" },
        // Where the pinned Nextflow version is read from; for tests.
        upstream: { type: "string" },
      },
    }).values;
  } catch (error) {
    console.error(`corpus-lint: ${(error as Error).message}`);
    console.error(USAGE);
    return 2;
  }
  let launcher: string;
  try {
    launcher = resolveLauncher({
      flag: values.nextflow,
      env: process.env,
      upstreamFile: values.upstream ? resolve(values.upstream) : UPSTREAM_FILE,
    }).path;
  } catch (error) {
    console.error(`corpus-lint: ${(error as Error).message}`);
    return 2;
  }
  if (!existsSync(launcher)) {
    console.error(
      `corpus-lint: no Nextflow launcher at ${launcher}. Pass --nextflow <path to nextflow-<version>-dist>, set NXF_LAUNCHER, or put the pinned dist at that path (see AGENTS.md).`,
    );
    return 2;
  }
  const manifest = loadManifest();
  const missing = manifest.pipelines.filter(
    (p) => !isUpToDate(DEFAULT_CACHE_DIR, p),
  );
  if (missing.length > 0) {
    console.error(
      `corpus-lint: ${missing.map((p) => p.id).join(", ")} missing from .cache/corpus; run pnpm corpus:fetch`,
    );
    return 2;
  }
  try {
    const results = lintCorpus({
      launcher,
      manifest,
      cacheDir: DEFAULT_CACHE_DIR,
      fixturesDir: FIXTURES_DIR,
      force: values.force,
      log: (line) => console.log(line),
    });
    const errors = results.reduce((n, r) => n + r.errors.length, 0);
    console.log(
      `corpus-lint: ${results.length} results in .cache/corpus-lint (${errors} lint errors in total)`,
    );
    return 0;
  } catch (error) {
    console.error(`corpus-lint: ${(error as Error).message}`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
