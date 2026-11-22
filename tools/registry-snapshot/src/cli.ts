import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pack } from "@nf-builder/lang-2610";
import { createRegistryApi } from "./api.ts";
import { buildSnapshot, readPreviousSnapshot } from "./build.ts";
import { writeSnapshot } from "./files.ts";
import { recordingFetch, replayFetch } from "./recording.ts";
import { reportMarkdown, snapshotSizes } from "./report.ts";

const USAGE =
  "Usage: pnpm registry:snapshot [--out <dir>] [--previous <dir>] [--report <file>] [--only <names>] [--plugins <ids>] [--record <dir> | --replay <dir>] [--now <iso>]";
const UPSTREAM = new URL(
  "../../../packages/lang-2610/upstream.json",
  import.meta.url,
);

const csv = (value: string | undefined): string[] | undefined =>
  value === undefined
    ? undefined
    : value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

/** Returns the exit code: 0 ok, 1 build error, 2 usage. */
export async function main(argv: string[]): Promise<number> {
  let values: Record<string, string | undefined>;
  try {
    values = parseArgs({
      args: argv[0] === "--" ? argv.slice(1) : argv,
      strict: true,
      options: {
        out: { type: "string" },
        previous: { type: "string" },
        report: { type: "string" },
        only: { type: "string" },
        plugins: { type: "string" },
        record: { type: "string" },
        replay: { type: "string" },
        now: { type: "string" },
      },
    }).values;
  } catch (error) {
    console.error(`registry-snapshot: ${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  if (values.record !== undefined && values.replay !== undefined) {
    console.error(
      `registry-snapshot: --record and --replay exclude each other\n${USAGE}`,
    );
    return 2;
  }
  const now = values.now === undefined ? undefined : new Date(values.now);
  if (now !== undefined && Number.isNaN(now.getTime())) {
    console.error(
      `registry-snapshot: --now is not a date: ${values.now}\n${USAGE}`,
    );
    return 2;
  }
  const out = resolve(values.out ?? ".cache/registry/out");
  const onlyModules = csv(values.only);
  // With --only and no --plugins, no plugins are built.
  const onlyPlugins = csv(values.plugins) ?? (onlyModules ? [] : undefined);

  const nextflow = (
    JSON.parse(readFileSync(UPSTREAM, "utf8")) as {
      nextflow: { version: string };
    }
  ).nextflow.version;
  const fetchImpl =
    values.replay !== undefined
      ? replayFetch(resolve(values.replay))
      : values.record !== undefined
        ? recordingFetch(resolve(values.record))
        : undefined;
  const api = createRegistryApi({
    fetch: fetchImpl,
    sleep: values.replay === undefined ? undefined : async () => {},
    log: (m) => console.log(m),
  });
  try {
    const previous =
      values.previous === undefined
        ? undefined
        : readPreviousSnapshot(resolve(values.previous));
    const { files, report } = await buildSnapshot({
      api,
      parser: await pack.loadParser(),
      language: pack.version,
      nextflow,
      now: () => now ?? new Date(),
      previous,
      only: { modules: onlyModules, plugins: onlyPlugins },
      log: (m) => console.log(m),
    });
    writeSnapshot(out, files);
    const markdown = reportMarkdown(report, snapshotSizes(files));
    if (values.report !== undefined) {
      mkdirSync(dirname(resolve(values.report)), { recursive: true });
      writeFileSync(resolve(values.report), markdown);
    }
    console.log(`registry-snapshot: wrote ${files.size} files to ${out}`);
    return 0;
  } catch (error) {
    console.error(`registry-snapshot: ${(error as Error).message}`);
    return 1;
  }
}

const isMain = (): boolean => {
  try {
    return import.meta.filename === realpathSync(process.argv[1] ?? "");
  } catch {
    return false;
  }
};
if (isMain()) process.exitCode = await main(process.argv.slice(2));
