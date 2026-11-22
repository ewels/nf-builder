// node tools/spec-extract/src/docs-compare.ts <version> [--ref <commit>] (F-006 step 3, ADR 0020): compares the
// generated catalogue with the Nextflow reference docs (GitHub sources at the pinned commit, read from
// raw.githubusercontent.com into .cache/docs/<commit>/) and prints a Markdown table.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { packDir, REPO_ROOT } from "./cli.ts";

const unique = (names: string[]): string[] => [...new Set(names)].sort();

/** The sorted, unique first capture group of every match of `re` (a global, multiline pattern) in `mdx`. */
const captures = (mdx: string, re: RegExp): string[] =>
  unique([...mdx.matchAll(re)].flatMap((m) => (m[1] ? [m[1]] : [])));

/** Rows of the directives table: "| [`name`][ref] | text |". */
export const directivesFromTable = (mdx: string): string[] =>
  captures(mdx, /^\| \[`(\w+)`\]/gm);

/** Second-level headings: "## name". */
export const operatorsFromHeadings = (mdx: string): string[] =>
  captures(mdx, /^## (\w+)\s*$/gm);

/** Callable headings: "##### `name( ... ) -> T`". Overloads repeat the name. */
export const callablesFromHeadings = (mdx: string): string[] =>
  captures(mdx, /^##### `(\w+)\(/gm);

/** Flag headings: "##### `nextflow.enable.strict`". */
export const featureFlagsFromHeadings = (mdx: string): string[] =>
  captures(mdx, /^##### `(nextflow\.[\w.]+)`\s*$/gm);

export function compare(
  docs: readonly string[],
  catalogue: readonly string[],
): { docsOnly: string[]; catalogueOnly: string[]; both: number } {
  const d = new Set(docs);
  const c = new Set(catalogue);
  return {
    docsOnly: [...d].filter((n) => !c.has(n)).sort(),
    catalogueOnly: [...c].filter((n) => !d.has(n)).sort(),
    both: [...d].filter((n) => c.has(n)).length,
  };
}

function fetchPage(commit: string, page: string): string {
  const file = join(REPO_ROOT, ".cache", "docs", commit, `${page}.mdx`);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const url = `https://raw.githubusercontent.com/nextflow-io/nextflow/${commit}/docs/reference/${page}.mdx`;
    const result = spawnSync(
      "curl",
      ["-fsSL", "--retry", "3", "-o", `${file}.part`, url],
      {
        encoding: "utf8",
      },
    );
    if (result.status !== 0)
      throw new Error(`could not fetch ${url}: ${result.stderr.trim()}`);
    renameSync(`${file}.part`, file);
  }
  return readFileSync(file, "utf8");
}

type Entry = { name: string; deprecated: boolean };
type Script = {
  directives: Entry[];
  operators: Entry[];
  factories: Entry[];
  featureFlags: Entry[];
};

export function report(script: Script, page: (name: string) => string): string {
  const names = (list: Entry[]): string[] => unique(list.map((e) => e.name));
  const typed = (list: Entry[]): string[] =>
    unique(list.filter((e) => !e.deprecated).map((e) => e.name));
  const rows: [string, string[], string[]][] = [
    [
      "Process directives (directives.mdx)",
      directivesFromTable(page("process/directives")),
      names(script.directives),
    ],
    [
      "Operators, all (operator.mdx)",
      operatorsFromHeadings(page("operator")),
      names(script.operators),
    ],
    [
      "Typed operators (stdlib-types channel.mdx and value.mdx)",
      unique([
        ...callablesFromHeadings(page("stdlib-types/channel")),
        ...callablesFromHeadings(page("stdlib-types/value")),
      ]),
      typed(script.operators),
    ],
    [
      "Channel factories (stdlib-namespaces/channel.mdx)",
      callablesFromHeadings(page("stdlib-namespaces/channel")),
      names(script.factories),
    ],
    [
      "Feature flags (feature-flags.mdx)",
      featureFlagsFromHeadings(page("feature-flags")),
      names(script.featureFlags),
    ],
  ];
  const cell = (list: string[]): string =>
    list.length > 0 ? list.join(", ") : "none";
  const lines = [
    "| Item | Docs | Catalogue | In both | Docs only | Catalogue only |",
    "| --- | ---: | ---: | ---: | --- | --- |",
  ];
  for (const [item, docs, catalogue] of rows) {
    const c = compare(docs, catalogue);
    lines.push(
      `| ${item} | ${docs.length} | ${catalogue.length} | ${c.both} | ${cell(c.docsOnly)} | ${cell(c.catalogueOnly)} |`,
    );
  }
  return lines.join("\n");
}

function main(argv: string[]): number {
  let ref: string | undefined;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv[0] === "--" ? argv.slice(1) : argv,
      allowPositionals: true,
      strict: true,
      options: { ref: { type: "string" } },
    });
    ref = parsed.values.ref;
    positionals = parsed.positionals;
  } catch (error) {
    console.error(`docs-compare: ${(error as Error).message}`);
    return 2;
  }
  const [version] = positionals;
  if (version === undefined) {
    console.error(
      "Usage: node tools/spec-extract/src/docs-compare.ts <version> [--ref <commit>]",
    );
    return 2;
  }
  try {
    const pack = packDir(version);
    const upstream = JSON.parse(
      readFileSync(join(pack, "upstream.json"), "utf8"),
    ) as {
      nextflow: { commit: string };
    };
    const commit = ref ?? upstream.nextflow.commit;
    const script = JSON.parse(
      readFileSync(join(pack, "catalogue", "script.json"), "utf8"),
    ) as Script;
    console.log(
      `Docs at nextflow-io/nextflow ${commit}, catalogue from ${basename(pack)}/catalogue/script.json\n`,
    );
    console.log(report(script, (page) => fetchPage(commit, page)));
    return 0;
  } catch (error) {
    console.error(`docs-compare: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.filename === process.argv[1])
  process.exitCode = main(process.argv.slice(2));
