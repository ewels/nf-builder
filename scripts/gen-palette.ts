// pnpm gen:palette <version> [--check] (F-109, ADR 0005, ADR 0025): mirrors a language pack's hand-edited
// palette.yaml to the committed palette.json that the pack imports (the browser can't parse YAML without a
// runtime dependency). Names are not validated here: the pack's palette test does that against the catalogue.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { isMain, packFor, REPO_ROOT } from "./check-common.ts";

/** "26.10" -> packages/lang-2610/palette.{yaml,json}. A version without a palette.yaml lists the packs that have one. */
export function palettePaths(
  version: string,
  repoRoot: string = REPO_ROOT,
): { yaml: string; json: string } {
  const dir = packFor(version, "palette.yaml", "palette.yaml", repoRoot);
  return { yaml: join(dir, "palette.yaml"), json: join(dir, "palette.json") };
}

/** The YAML as two-space JSON with a trailing newline, keys in YAML order. Throws "<file>:<line>: ..." on YAML errors. */
export function paletteJson(yamlText: string, file: string): string {
  const doc = parseDocument(yamlText, { schema: "core" });
  const [error] = doc.errors;
  if (error !== undefined) {
    const line = error.linePos?.[0].line ?? 1;
    throw new Error(`${file}:${line}: ${error.message.split("\n")[0]}`);
  }
  return `${JSON.stringify(doc.toJS(), null, 2)}\n`;
}

export function genPalette(opts: {
  version: string;
  check?: boolean;
  repoRoot?: string;
}): { status: 0 | 1; message: string } {
  const paths = palettePaths(opts.version, opts.repoRoot);
  const json = paletteJson(readFileSync(paths.yaml, "utf8"), paths.yaml);
  if (opts.check) {
    const current = existsSync(paths.json)
      ? readFileSync(paths.json, "utf8")
      : undefined;
    return current === json
      ? {
          status: 0,
          message: `gen:palette ${opts.version}: palette.json matches palette.yaml`,
        }
      : {
          status: 1,
          message: `palette.json differs from palette.yaml; edit palette.yaml and run pnpm gen:palette ${opts.version}, never hand-edit palette.json`,
        };
  }
  writeFileSync(paths.json, json);
  return {
    status: 0,
    message: `gen:palette ${opts.version}: wrote ${paths.json}`,
  };
}

/** Exit codes: 0 ok, 1 differs or invalid YAML, 2 usage. */
export function main(argv: readonly string[]): number {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const check = args.includes("--check");
  const rest = args.filter((a) => a !== "--check");
  const version = rest[0];
  if (version === undefined || rest.length !== 1) {
    console.error(
      "usage: pnpm gen:palette <version> [--check]   e.g. pnpm gen:palette 26.10",
    );
    return 2;
  }
  try {
    const { status, message } = genPalette({ version, check });
    (status === 0 ? console.log : console.error)(message);
    return status;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isMain(import.meta)) process.exitCode = main(process.argv.slice(2));
