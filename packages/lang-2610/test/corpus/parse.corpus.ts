// F-006 (spike S2, ADR 0005): parse every file of the pinned corpus and the malformed fixtures, compare with what
// `nextflow lint` said, and write .cache/reports/parse-corpus.{json,md}. Run by `pnpm test:corpus` after
// `pnpm corpus:fetch` and `pnpm corpus:lint`. Reads .cache/ and tools/corpus/fixtures/ by path; imports nothing from tools/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import {
  BailErrorStrategy,
  CharStream,
  CommonTokenStream,
  ParseCancellationException,
  PredictionMode,
  Trees,
} from "antlr4ng";
import { beforeAll, describe, expect, it } from "vitest";
import { ConfigLexer } from "../../src/generated/ConfigLexer.ts";
import { ConfigParser } from "../../src/generated/ConfigParser.ts";
import { ScriptLexer } from "../../src/generated/ScriptLexer.ts";
import { ScriptParser } from "../../src/generated/ScriptParser.ts";
import { parseConfig, parseScript } from "../../src/index.ts";
import {
  compare,
  type FileOutcome,
  listSources,
  loadKnownDifferences,
} from "./corpus-files.ts";

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

type LintFile = {
  filesChecked: number;
  errors: { filename: string; startLine: number; message: string }[];
};
type Parsed = {
  pipeline: string;
  file: string;
  parser: "ok" | "error";
  mode: string;
  ms: number;
  error?: string;
  line?: number;
};
type Pass = { files: Parsed[]; ms: number };

function parseAll(id: string): Pass {
  const files: Parsed[] = [];
  const started = performance.now();
  for (const source of listSources(dirOf(id))) {
    const text = readFileSync(join(dirOf(id), source.path), "utf8");
    const t0 = performance.now();
    const outcome =
      source.kind === "script" ? parseScript(text) : parseConfig(text);
    const ms = performance.now() - t0;
    files.push(
      outcome.ok
        ? {
            pipeline: id,
            file: source.path,
            parser: "ok",
            mode: outcome.mode,
            ms,
          }
        : {
            pipeline: id,
            file: source.path,
            parser: "error",
            mode: outcome.mode,
            ms,
            error: `${outcome.error.source}: ${outcome.error.message}`,
            line: outcome.error.line,
          },
    );
  }
  return { files, ms: performance.now() - started };
}

/** The tree (as a string) of a pure LL parse with no stage 1, or undefined if it fails. */
function pureLl(kind: "script" | "config", text: string): string | undefined {
  const input = CharStream.fromString(text);
  const [lexer, parser] =
    kind === "script"
      ? (() => {
          const l = new ScriptLexer(input);
          return [l, new ScriptParser(new CommonTokenStream(l))] as const;
        })()
      : (() => {
          const l = new ConfigLexer(input);
          return [l, new ConfigParser(new CommonTokenStream(l))] as const;
        })();
  lexer.removeErrorListeners();
  parser.removeErrorListeners();
  parser.errorHandler = new BailErrorStrategy();
  parser.interpreter.predictionMode = PredictionMode.LL;
  try {
    return Trees.toStringTree(parser.compilationUnit(), parser.ruleNames);
  } catch (error) {
    if (error instanceof ParseCancellationException) return undefined;
    // A lexer error is a failure for the parser under test too.
    return undefined;
  }
}

// Pure LL on all of sarek takes about a minute, so compare every file of the small pipelines and a fixed sample of sarek.
const TREE_CHECKED = ["rnaseq-nf", "rnaseq-nf-typed", "fetchngs", "fixtures"];
const SAREK_SAMPLE = 20;

const state = {
  lint: new Map<string, LintFile>(),
  cold: undefined as Pass | undefined,
  warm: undefined as Pass | undefined,
  passes: new Map<string, Pass>(),
};

const missingHint = (id: string) =>
  `${id}: missing ${dirOf(id)} or ${join(LINT, `${id}.json`)}; run pnpm corpus:fetch and then pnpm corpus:lint`;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
  );
}

const stats = (pass: Pass) => {
  const ms = pass.files.map((f) => f.ms);
  return {
    files: pass.files.length,
    totalMs: pass.ms,
    p95Ms: percentile(ms, 0.95),
    maxMs: Math.max(...ms),
    maxFile: pass.files.find((f) => f.ms === Math.max(...ms))?.file ?? "",
  };
};

beforeAll(() => {
  for (const id of IDS) {
    if (!existsSync(dirOf(id)) || !existsSync(join(LINT, `${id}.json`)))
      continue;
    state.lint.set(
      id,
      JSON.parse(readFileSync(join(LINT, `${id}.json`), "utf8")) as LintFile,
    );
  }
  if (state.lint.size !== IDS.length) return;
  // Sarek first for a cold timing, then the rest, then sarek again for a warm one.
  state.cold = parseAll("sarek");
  state.passes.set("sarek", state.cold);
  for (const id of IDS) if (id !== "sarek") state.passes.set(id, parseAll(id));
  state.warm = parseAll("sarek");
});

const parsedFiles = (): Parsed[] =>
  IDS.flatMap((id) => state.passes.get(id)?.files ?? []);
const known = () =>
  loadKnownDifferences(join(import.meta.dirname, "known-differences.json"));
const lintErrorFiles = () =>
  new Map(
    IDS.map((id) => [
      id,
      new Set((state.lint.get(id)?.errors ?? []).map((e) => e.filename)),
    ]),
  );
const outcomes = (): FileOutcome[] =>
  parsedFiles().map((f) => ({
    pipeline: f.pipeline,
    file: f.file,
    parser: f.parser,
  }));

describe("corpus parse", () => {
  it("F-006 step 1: every pinned pipeline and its lint result are present", () => {
    expect(pinned.length).toBeGreaterThanOrEqual(5);
    const missing = IDS.filter((id) => !state.lint.has(id));
    expect(
      missing.map(missingHint),
      "run pnpm corpus:fetch, then pnpm corpus:lint",
    ).toEqual([]);
  });

  it("F-006 step 1: each pipeline's file list matches the number of files nextflow lint checked", () => {
    for (const id of IDS) {
      const lint = state.lint.get(id);
      expect(lint, missingHint(id)).toBeDefined();
      expect(
        listSources(dirOf(id)).length,
        `${id}: files listed vs checked by lint`,
      ).toBe(lint?.filesChecked);
    }
  });

  it("F-006 step 2 ADR-0005: every file nextflow lint accepts parses, apart from listed differences", () => {
    const { unexpected } = compare(outcomes(), lintErrorFiles(), known());
    const details = unexpected.map((d) => {
      const f = parsedFiles().find(
        (p) => p.pipeline === d.pipeline && p.file === d.file,
      );
      const lintError = state.lint
        .get(d.pipeline)
        ?.errors.find((e) => e.filename === d.file);
      return `${d.pipeline}/${d.file}: lint=${d.lint} parser=${d.parser}; parser: ${f?.error ?? "ok"} (line ${f?.line ?? "-"}); lint: ${lintError ? `${lintError.message} (line ${lintError.startLine})` : "ok"}`;
    });
    expect(details).toEqual([]);
  });

  it("F-006 step 2: every listed difference still occurs and states a cause", () => {
    const rows = known();
    for (const row of rows) expect(row.cause.trim()).not.toBe("");
    expect(compare(outcomes(), lintErrorFiles(), rows).stale).toEqual([]);
  });

  it("F-006 step 2: each malformed fixture lint rejects is rejected by the parser or listed with a cause", () => {
    const rows = known();
    const rejected = new Set(
      (state.lint.get("fixtures")?.errors ?? []).map((e) => e.filename),
    );
    expect(rejected.size).toBeGreaterThan(0);
    for (const file of rejected) {
      const parsed = parsedFiles().find(
        (p) => p.pipeline === "fixtures" && p.file === file,
      );
      const listed = rows.some(
        (r) => r.pipeline === "fixtures" && r.file === file,
      );
      expect(
        parsed?.parser === "error" || listed,
        `fixtures/${file}: lint rejects it; the parser accepts it and no cause is listed`,
      ).toBe(true);
    }
  });

  it("F-006 QA-03: the hybrid stage 1 tree equals the pure LL tree for every file of the small pipelines and a sample of sarek", () => {
    const mismatches: string[] = [];
    let compared = 0;
    for (const id of [...TREE_CHECKED, "sarek"]) {
      let sources = listSources(dirOf(id));
      if (id === "sarek") {
        const step = Math.max(1, Math.floor(sources.length / SAREK_SAMPLE));
        sources = sources
          .filter((_, i) => i % step === 0)
          .slice(0, SAREK_SAMPLE);
      }
      for (const source of sources) {
        const text = readFileSync(join(dirOf(id), source.path), "utf8");
        const expected = pureLl(source.kind, text);
        const outcome =
          source.kind === "script" ? parseScript(text) : parseConfig(text);
        const actual = outcome.ok
          ? Trees.toStringTree(
              outcome.tree,
              source.kind === "script"
                ? ScriptParser.ruleNames
                : ConfigParser.ruleNames,
            )
          : undefined;
        compared++;
        if (actual !== expected) mismatches.push(`${id}/${source.path}`);
      }
    }
    expect(compared).toBeGreaterThan(SAREK_SAMPLE);
    expect(mismatches).toEqual([]);
  });

  it("F-006 step 1: writes the parse report with pass rate per pipeline and sarek cold and warm parse time", () => {
    expect(
      state.cold && state.warm,
      "run pnpm corpus:fetch and pnpm corpus:lint first",
    ).toBeTruthy();
    const all = parsedFiles();
    const cold = stats(state.cold as Pass);
    const warm = stats(state.warm as Pass);
    const diffs = compare(outcomes(), lintErrorFiles(), known());
    const rows = IDS.map((id) => {
      const files = all.filter((f) => f.pipeline === id);
      const parsed = files.filter((f) => f.parser === "ok").length;
      return {
        pipeline: id,
        files: files.length,
        parsed,
        passRate: files.length === 0 ? 0 : parsed / files.length,
        sllToLlFallbacks: files.filter((f) => f.mode === "LL").length,
        lintAccepted: files.length - (lintErrorFiles().get(id)?.size ?? 0),
        differences:
          diffs.listed.filter((d) => d.pipeline === id).length +
          diffs.unexpected.filter((d) => d.pipeline === id).length,
      };
    });
    const cpu = cpus();
    const env = {
      node: process.version,
      cpu: `${cpu[0]?.model ?? "unknown"} x${cpu.length}`,
    };
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(
      join(REPORTS, "parse-corpus.json"),
      `${JSON.stringify({ env, rows, sarek: { cold, warm }, files: all }, null, 2)}\n`,
    );
    const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
    const ms = (n: number) => n.toFixed(1);
    const table = [
      "| Pipeline | Files | Parsed | Pass rate | SLL to LL fallbacks | Lint accepted | Differences |",
      "|---|---|---|---|---|---|---|",
      ...rows.map(
        (r) =>
          `| ${r.pipeline} | ${r.files} | ${r.parsed} | ${pct(r.passRate)} | ${r.sllToLlFallbacks} | ${r.lintAccepted} | ${r.differences} |`,
      ),
    ];
    const timing = (name: string, s: ReturnType<typeof stats>) =>
      `| ${name} | ${s.files} | ${ms(s.totalMs)} | ${ms(s.p95Ms)} | ${ms(s.maxMs)} (${s.maxFile}) |`;
    writeFileSync(
      join(REPORTS, "parse-corpus.md"),
      [
        "# Corpus parse report (F-006)",
        "",
        ...table,
        "",
        "Sarek parse time in Node, without the model and outside a worker (QA-03 is measured in F-113):",
        "",
        "| Run | Files | Total ms | p95 ms per file | Max ms per file |",
        "|---|---|---|---|---|",
        timing("cold (first parse in the process)", cold),
        timing("warm (second parse)", warm),
        "",
        `Node ${env.node}; CPU ${env.cpu}.`,
        "",
      ].join("\n"),
    );
    expect(cold.totalMs).toBeGreaterThan(0);
    expect(warm.totalMs).toBeGreaterThan(0);
    expect(rows).toHaveLength(IDS.length);
  });
});
