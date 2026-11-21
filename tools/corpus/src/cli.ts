import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isUpToDate, syncCorpus } from "./fetch.ts";
import { DEFAULT_CACHE_DIR, loadManifest, MANIFEST_FILE } from "./manifest.ts";

const USAGE =
  "Usage: pnpm corpus:fetch [--check] [--manifest <file>] [--cache-dir <dir>]";

const display = (dir: string): string => {
  const rel = relative(process.cwd(), dir);
  return rel !== "" && !rel.startsWith("..") ? rel : dir;
};

/** Returns the exit code. Prints progress to stdout and problems to stderr. */
function main(argv: string[]): number {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let values: { check?: boolean; manifest?: string; "cache-dir"?: string };
  try {
    values = parseArgs({
      args,
      strict: true,
      options: {
        check: { type: "boolean" },
        manifest: { type: "string" },
        "cache-dir": { type: "string" },
      },
    }).values;
  } catch (error) {
    console.error(`corpus: ${(error as Error).message}`);
    console.error(USAGE);
    return 2;
  }
  const manifestFile = resolve(values.manifest ?? MANIFEST_FILE);
  const cacheDir = resolve(values["cache-dir"] ?? DEFAULT_CACHE_DIR);
  let manifest: ReturnType<typeof loadManifest>;
  try {
    manifest = loadManifest(manifestFile);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  const total = manifest.pipelines.length;

  if (values.check) {
    const missing = manifest.pipelines.filter((p) => !isUpToDate(cacheDir, p));
    for (const p of missing)
      console.error(
        `corpus: ${p.id} (${p.repo}@${p.ref} ${p.sha.slice(0, 12)}) is missing from ${display(cacheDir)}; run pnpm corpus:fetch`,
      );
    if (missing.length > 0) return 1;
    console.log(
      `corpus: ${total} pipelines up to date in ${display(cacheDir)}`,
    );
    return 0;
  }

  const result = syncCorpus(manifest, cacheDir, (line) => console.log(line));
  if (result.failed.length > 0) {
    for (const f of result.failed) console.error(`corpus: ${f.message}`);
    console.error(
      `corpus: ${result.failed.length} of ${total} pipelines failed`,
    );
    return 1;
  }
  console.log(
    `corpus: ${result.fetched.length} fetched, ${result.upToDate.length} up to date in ${display(cacheDir)}`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
