// F-104 step 1 (ADR 0004, IO-14, IO-20): every pinned corpus file and the malformed fixtures go through the pack's
// parser and the engine, with no edits: print gives the text back byte for byte, the printed text is equivalent to the
// original, the model accounts for every character, and every file lint accepts is fully modelled. Run by
// `pnpm test:corpus` after `pnpm corpus:fetch` and `pnpm corpus:lint`. Reads .cache/ and tools/corpus/fixtures/ by path.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SourceParser } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createSourceFile,
  equivalent,
  loadParser,
  printSourceFile,
  type SourceFile,
  verifyModel,
} from "../../src/index";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const LINT = join(ROOT, ".cache/corpus-lint");
const FIXTURES = join(ROOT, "tools/corpus/fixtures");
const REPORTS = join(ROOT, ".cache/reports");

const pinned = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);
const IDS = [...pinned, "fixtures"];
const dirOf = (id: string) => (id === "fixtures" ? FIXTURES : join(CORPUS, id));

/** nextflow lint's default excludes (26.10), as in lang-2610's corpus-files.ts. */
const LINT_EXCLUDES = [
  ".git",
  ".lineage",
  ".nextflow",
  ".nf-test",
  "nf-test.config",
  "work",
];
function listSources(dir: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(dir, relative), {
      withFileTypes: true,
    })) {
      if (LINT_EXCLUDES.includes(entry.name)) continue;
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".nf") || entry.name.endsWith(".config"))
        found.push(path);
    }
  };
  walk("");
  return found.sort();
}

type LintFile = { filesChecked: number; errors: { filename: string }[] };
type Row = {
  id: string;
  path: string;
  text: string;
  file: SourceFile;
  printed: string;
  reparsed: SourceFile;
};
const state = {
  lint: new Map<string, LintFile>(),
  rows: [] as Row[],
  ms: 0,
};

beforeAll(async () => {
  const parser: SourceParser = await loadParser("26.10");
  for (const id of IDS) {
    const lintPath = join(LINT, `${id}.json`);
    if (!existsSync(dirOf(id)) || !existsSync(lintPath)) continue;
    state.lint.set(id, JSON.parse(readFileSync(lintPath, "utf8")) as LintFile);
  }
  if (state.lint.size !== IDS.length) return;
  const started = performance.now();
  for (const id of IDS)
    for (const path of listSources(dirOf(id))) {
      const text = readFileSync(join(dirOf(id), path), "utf8");
      const file = createSourceFile(path, text, parser);
      const printed = printSourceFile(file);
      state.rows.push({
        id,
        path,
        text,
        file,
        printed,
        reparsed: createSourceFile(path, printed, parser),
      });
    }
  state.ms = performance.now() - started;
});

const name = (r: Row) => `${r.id}/${r.path}`;

describe("F-104 step 1: the round trip over the corpus", () => {
  it("F-104 step 1: every pinned pipeline and the fixtures are present, with as many files as nextflow lint checked", () => {
    expect(
      IDS.filter((id) => !state.lint.has(id)),
      "run pnpm corpus:fetch, then pnpm corpus:lint",
    ).toEqual([]);
    for (const id of IDS)
      expect(listSources(dirOf(id)).length, id).toBe(
        state.lint.get(id)?.filesChecked,
      );
    expect(state.rows.filter((r) => r.id !== "fixtures")).toHaveLength(570);
    expect(state.rows.filter((r) => r.id === "fixtures")).toHaveLength(9);
  });

  it("F-104 step 1 IO-20 ADR-0004: every corpus file prints back byte for byte and equivalent with no edits", () => {
    expect(state.rows.length).toBeGreaterThan(570);
    expect(state.rows.filter((r) => r.printed !== r.text).map(name)).toEqual(
      [],
    );
    const different = state.rows.flatMap((r) => {
      const e = equivalent(r.file, r.reparsed);
      return e.equivalent ? [] : [`${name(r)}: ${e.reason}`];
    });
    expect(different).toEqual([]);
  });

  it("F-104 step 1 ADR-0004: every file's model accounts for every character", () => {
    const broken = state.rows.flatMap((r) => {
      const issues = verifyModel(r.file);
      return issues.length > 0 ? [`${name(r)}: ${issues[0]}`] : [];
    });
    expect(broken).toEqual([]);
    expect(
      state.rows
        .filter((r) => r.file.problems.some((p) => p.source === "internal"))
        .map(name),
    ).toEqual([]);
  });

  it("F-104 IO-14 ADR-0005: every file nextflow lint accepts is fully modelled, and every file it rejects still imports", () => {
    const rejected = (r: Row) =>
      (state.lint.get(r.id)?.errors ?? []).some((e) => e.filename === r.path);
    const clean = state.rows.filter((r) => !rejected(r));
    expect(
      clean
        .filter((r) => r.file.status !== "modelled" || r.file.problems.length)
        .map(name),
    ).toEqual([]);
    const bad = state.rows.filter(rejected);
    expect(bad.length).toBeGreaterThan(0);
    for (const r of bad)
      expect(["partial", "verbatim"], name(r)).toContain(r.file.status);
  });

  it("F-104 step 1: writes the round-trip report", () => {
    const counts = new Map<string, number>();
    for (const r of state.rows)
      counts.set(r.file.status, (counts.get(r.file.status) ?? 0) + 1);
    const lines = [
      "## Round trip (F-104)",
      "",
      `${state.rows.length} files, ${Math.round(state.ms)} ms (parse, print and re-parse).`,
      "",
      "| Status | Files |",
      "|---|---|",
      ...[...counts].sort().map(([s, n]) => `| ${s} | ${n} |`),
      "",
    ];
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(join(REPORTS, "round-trip.md"), `${lines.join("\n")}\n`);
    expect(counts.get("plain")).toBeUndefined();
  });
});
