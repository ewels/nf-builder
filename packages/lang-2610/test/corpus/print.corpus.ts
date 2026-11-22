// F-110 (ADR 0005, LA-45): print every script of the pinned corpus that `nextflow lint` accepts and compare it with what
// `nextflow lint -format` wrote (.cache/corpus-lint/<id>.format/, from `pnpm corpus:lint`). Run by `pnpm test:corpus` after
// `pnpm corpus:fetch` and `pnpm corpus:lint`. A file may differ only if known-format-differences.json lists it with the id
// of a known upstream bug; any other difference is a printer bug. Reads .cache/ by path; imports nothing from tools/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import { createLayout, printScript } from "../../src/printer/index.ts";
import { lineDiff } from "../printer/line-diff.ts";
import { listSources } from "./corpus-files.ts";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const LINT = join(ROOT, ".cache/corpus-lint");
const REPORTS = join(ROOT, ".cache/reports");

const IDS = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

type Known = {
  pipeline: string;
  file: string;
  knownDifference: string;
  cause: string;
  /** The lines (1-based) where our output and nf-lang's differ: what the known bug changes and nothing else. */
  differingLines: { formatted: number[]; printed: number[] };
};
const KNOWN_IDS = Object.keys(
  (
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../printer/fixtures.json"),
        "utf8",
      ),
    ) as { knownDifferences: Record<string, string> }
  ).knownDifferences,
);
const known = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "known-format-differences.json"),
    "utf8",
  ),
) as Known[];
const knownFor = (pipeline: string, file: string) =>
  known.find((k) => k.pipeline === pipeline && k.file === file);
const isKnown = (pipeline: string, file: string) =>
  knownFor(pipeline, file) !== undefined;

type Row = {
  pipeline: string;
  file: string;
  /** nf-lang's output, or the original text when lint -format left the file alone. */
  formatted: string;
  printed: string | null;
  /** Printing the formatted text again. */
  reprinted: string | null;
  error?: string;
};

const state = { rows: [] as Row[], missing: [] as string[], ms: 0 };

function print(text: string): string {
  const parsed = parseScriptAst(text);
  if (!parsed.ok || parsed.errors.length > 0)
    throw new Error(
      `parse: ${(parsed.ok ? parsed.errors : parsed.errors)[0]?.message}`,
    );
  const result = printScript(parsed.ast, { layout: createLayout(text) });
  if (result.missingComments.length > 0)
    throw new Error(`${result.missingComments.length} comment(s) not printed`);
  return result.text;
}

beforeAll(() => {
  const started = performance.now();
  for (const id of IDS) {
    const lintFile = join(LINT, `${id}.json`);
    const formatTree = join(LINT, `${id}.format`);
    if (!existsSync(lintFile) || !existsSync(formatTree)) {
      state.missing.push(id);
      continue;
    }
    const lint = JSON.parse(readFileSync(lintFile, "utf8")) as {
      errors: { filename: string }[];
    };
    const rejected = new Set(lint.errors.map((e) => e.filename));
    for (const source of listSources(join(CORPUS, id))) {
      if (source.kind !== "script" || rejected.has(source.path)) continue;
      const original = readFileSync(join(CORPUS, id, source.path), "utf8");
      const formatted = readFileSync(join(formatTree, source.path), "utf8");
      const row: Row = {
        pipeline: id,
        file: source.path,
        formatted,
        printed: null,
        reprinted: null,
      };
      try {
        row.printed = print(original);
        row.reprinted = print(formatted);
      } catch (error) {
        row.error = (error as Error).message;
      }
      state.rows.push(row);
    }
  }
  state.ms = performance.now() - started;
});

const hint = (ids: string[]) =>
  `${ids.join(", ")}: missing .cache/corpus-lint/<id>.format; run pnpm corpus:fetch and then pnpm corpus:lint`;

describe("corpus printer parity", () => {
  it("F-110 LA-45 ADR-0005: every corpus script nextflow lint formats prints as it formats it", () => {
    expect(state.missing, hint(state.missing)).toEqual([]);
    const errors = state.rows.filter((r) => r.error);
    expect(errors.map((r) => `${r.pipeline}/${r.file}: ${r.error}`)).toEqual(
      [],
    );
    const different = state.rows.filter((r) => r.printed !== r.formatted);
    const unexpected = different.filter((r) => !isKnown(r.pipeline, r.file));
    expect(
      unexpected.map((r) => `${r.pipeline}/${r.file}`),
      "differences that are not listed as known upstream bugs",
    ).toEqual([]);
    // a listed file that no longer differs must come out of the list
    const stale = known.filter(
      (k) =>
        !different.some((r) => r.pipeline === k.pipeline && r.file === k.file),
    );
    expect(stale.map((k) => `${k.pipeline}/${k.file}`)).toEqual([]);
    for (const k of known) expect(KNOWN_IDS).toContain(k.knownDifference);
    // and only on the lines the known bug changes
    for (const r of different) {
      const k = knownFor(r.pipeline, r.file);
      expect(
        lineDiff(r.formatted, r.printed ?? ""),
        `${r.pipeline}/${r.file}`,
      ).toEqual(k?.differingLines);
    }
    expect(state.rows.length).toBeGreaterThan(0);
    report();
  });

  it("F-110 LA-45: printing every formatted corpus script again changes nothing", () => {
    const changed = state.rows.filter((r) => r.reprinted !== r.formatted);
    expect(changed.map((r) => `${r.pipeline}/${r.file}`)).toEqual([]);
  });
});

/** Appends the counts to .cache/reports/parse-corpus.md (replacing an earlier printer section). */
function report(): void {
  const rows = state.rows;
  const different = rows.filter((r) => r.printed !== r.formatted).length;
  const section = [
    "## Printer parity (F-110)",
    "",
    "| Pipeline | Files compared | Identical | Known differences |",
    "|---|---|---|---|",
    ...IDS.map((id) => {
      const mine = rows.filter((r) => r.pipeline === id);
      const diff = mine.filter((r) => r.printed !== r.formatted).length;
      return `| ${id} | ${mine.length} | ${mine.length - diff} | ${diff} |`;
    }),
    `| total | ${rows.length} | ${rows.length - different} | ${different} |`,
    "",
    `Parse and print time for every file, twice: ${(state.ms / 1000).toFixed(1)} s.`,
    "",
  ].join("\n");
  mkdirSync(REPORTS, { recursive: true });
  const file = join(REPORTS, "parse-corpus.md");
  const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
  const base = previous.split("\n## Printer parity")[0]?.trimEnd() ?? "";
  writeFileSync(file, `${base}${base ? "\n\n" : ""}${section}`);
}
