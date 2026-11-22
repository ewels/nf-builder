// F-102 (ADR 0005, ADR 0027): build the AST of every script in the pinned corpus and the malformed fixtures, and check
// that it agrees with `nextflow lint` and with nf-lang's CommentAttacher. Run by `pnpm test:corpus` after
// `pnpm corpus:fetch` and `pnpm corpus:lint` (which also writes .cache/corpus-lint/<id>.comments.json with CommentDump.java).
// Reads .cache/ and tools/corpus/fixtures/ by path; imports nothing from tools/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AstNode, type ScriptAst, walk } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import { checkRanges } from "../ast/check-ranges.ts";
import {
  type Attachment,
  anchors,
  attachments,
  type Row,
} from "../ast/comment-anchors.ts";
import { listSources } from "./corpus-files.ts";

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

// The same sample parse.corpus.ts uses for the tree comparison: the property check re-parses every node there.
const FULL_REPARSE = ["rnaseq-nf", "rnaseq-nf-typed", "fetchngs", "fixtures"];
const SAREK_SAMPLE = 20;

type Built = {
  pipeline: string;
  file: string;
  text: string;
  result: ReturnType<typeof parseScriptAst>;
  ms: number;
  /** Re-parse every node, not just declarations. */
  full: boolean;
};
type LintFile = { errors: { filename: string }[] };
type DumpRow = {
  line: number;
  column: number;
  text: string;
  slot: Row["slot"];
  node: {
    class: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
  };
};
type Dump = {
  files: { file: string; comments?: DumpRow[]; error?: string }[];
};

const state = {
  built: [] as Built[],
  lint: new Map<string, LintFile>(),
  dumps: new Map<string, Dump>(),
  /** Set by the comment comparison, for the report. */
  comparison: { compared: 0, labelStart: 0, upstream: 0 },
};

beforeAll(() => {
  for (const id of IDS) {
    const lint = join(LINT, `${id}.json`);
    if (!existsSync(dirOf(id)) || !existsSync(lint)) continue;
    state.lint.set(id, JSON.parse(readFileSync(lint, "utf8")) as LintFile);
    const comments = join(LINT, `${id}.comments.json`);
    if (existsSync(comments))
      state.dumps.set(id, JSON.parse(readFileSync(comments, "utf8")) as Dump);
  }
  if (state.lint.size !== IDS.length) return;
  for (const id of IDS) {
    const sources = listSources(dirOf(id)).filter((s) => s.kind === "script");
    const sample = new Set<string>();
    if (id === "sarek") {
      const step = Math.max(1, Math.floor(sources.length / SAREK_SAMPLE));
      for (const s of sources
        .filter((_, i) => i % step === 0)
        .slice(0, SAREK_SAMPLE))
        sample.add(s.path);
    }
    for (const source of sources) {
      const text = readFileSync(join(dirOf(id), source.path), "utf8");
      const t0 = performance.now();
      const result = parseScriptAst(text);
      state.built.push({
        pipeline: id,
        file: source.path,
        text,
        result,
        ms: performance.now() - t0,
        full: FULL_REPARSE.includes(id) || sample.has(source.path),
      });
    }
  }
});

const missingHint = (id: string) =>
  `${id}: missing ${dirOf(id)} or ${join(LINT, `${id}.json`)}; run pnpm corpus:fetch and then pnpm corpus:lint`;
const rejectedByLint = (b: Built) =>
  (state.lint.get(b.pipeline)?.errors ?? []).some((e) => e.filename === b.file);
const okBuilds = () =>
  state.built.flatMap((b) =>
    b.result.ok ? [{ ...b, ast: b.result.ast }] : [],
  );

const countNodes = (ast: ScriptAst) => {
  let n = 0;
  walk(ast, () => {
    n++;
  });
  return n;
};

describe("corpus AST", () => {
  it("F-102 ADR-0005: every pinned pipeline, its lint result and its comment dump are present", () => {
    const missing = IDS.filter(
      (id) => !state.lint.has(id) || !state.dumps.has(id),
    );
    expect(
      missing.map(missingHint),
      "run pnpm corpus:fetch, then pnpm corpus:lint",
    ).toEqual([]);
    expect(state.built.length).toBeGreaterThan(300);
  });

  it("F-102 ADR-0005: every corpus script nextflow lint accepts builds with no builder errors; the ones it rejects fail or report errors", () => {
    const wrong: string[] = [];
    let rejected = 0;
    for (const b of state.built) {
      const failed = !b.result.ok || b.result.errors.length > 0;
      if (rejectedByLint(b)) {
        rejected++;
        if (!failed)
          wrong.push(
            `${b.pipeline}/${b.file}: lint rejects it, the builder accepts it`,
          );
      } else if (failed) {
        wrong.push(
          `${b.pipeline}/${b.file}: lint accepts it; ${JSON.stringify(b.result.errors.slice(0, 2))}`,
        );
      }
    }
    expect(wrong).toEqual([]);
    expect(rejected).toBeGreaterThan(0);
  });

  it("F-102 step 2 AR-02: every node in every corpus script slices back to its exact source text", () => {
    const problems: string[] = [];
    for (const b of okBuilds()) {
      const found = checkRanges(b.ast, b.text, {
        reparse: b.full ? "all" : "declarations",
        attached: true,
      });
      for (const problem of found.slice(0, 3))
        problems.push(`${b.pipeline}/${b.file}: ${problem}`);
    }
    expect(problems).toEqual([]);
  });

  it("F-102 AR-02: every comment in the corpus is attached once and slices back exactly", () => {
    const problems: string[] = [];
    let comments = 0;
    for (const b of okBuilds()) {
      comments += b.ast.comments.length + (b.ast.shebang ? 1 : 0);
      const found = checkRanges(b.ast, b.text, {
        reparse: "none",
        attached: true,
      });
      for (const problem of found.slice(0, 3))
        problems.push(`${b.pipeline}/${b.file}: ${problem}`);
      for (const [key, list] of attachments(b.ast))
        if (list.length !== 1)
          problems.push(
            `${b.pipeline}/${b.file} ${key}: attached ${list.length} times`,
          );
    }
    expect(problems).toEqual([]);
    expect(comments).toBeGreaterThan(3000);
  });

  it("F-102 AR-02: corpus comment attachment matches nf-lang 26.10.7", () => {
    const differences: string[] = [];
    let compared = 0;
    let labelStart = 0;
    let upstream = 0;
    for (const b of okBuilds()) {
      const file = state.dumps
        .get(b.pipeline)
        ?.files.find((f) => f.file === b.file);
      if (!file?.comments) continue; // the builder rejected the file upstream too
      upstream += file.comments.length;
      const ours = attachments(b.ast);
      const keys = file.comments.map((r) => `${r.line}:${r.column}`);
      if (
        JSON.stringify([...ours.keys()].sort()) !==
        JSON.stringify([...keys].sort())
      ) {
        differences.push(
          `${b.pipeline}/${b.file}: the attached comments differ`,
        );
        continue;
      }
      for (const dumped of file.comments) {
        const key = `${dumped.line}:${dumped.column}`;
        const mine = (ours.get(key) as Attachment[])[0] as Attachment;
        const row: Row = {
          line: dumped.line,
          column: dumped.column,
          slot: dumped.slot,
          anchor: dumped.node.class,
          from: [dumped.node.line, dumped.node.column],
          to: [dumped.node.endLine, dumped.node.endColumn],
          text: dumped.text,
        };
        const where = `${b.pipeline}/${b.file} ${key} ${JSON.stringify(dumped.text.slice(0, 30))}`;
        if (mine.slot !== row.slot) {
          differences.push(`${where}: slot ${mine.slot}, nf-lang ${row.slot}`);
        } else if (
          !anchors(row, mine.node as AstNode & Record<string, unknown>, {
            allowLabelStart: true,
          })
        ) {
          differences.push(
            `${where}: anchor ${mine.node.kind}@${mine.node.range.line}:${mine.node.range.column}, nf-lang ${row.anchor}@${row.from}-${row.to}`,
          );
        } else {
          compared++;
          if (!anchors(row, mine.node as AstNode & Record<string, unknown>))
            labelStart++;
        }
      }
    }
    expect(differences.slice(0, 20)).toEqual([]);
    // every comment nf-lang attached (3,923 at the pinned pipelines) is attached the same way
    expect(compared).toBe(upstream);
    expect(compared).toBeGreaterThan(3000);
    state.comparison = { compared, labelStart, upstream };
  });

  it("F-102 AR-02: writes the AST report with node, comment and builder-error counts and build time", () => {
    const rows = IDS.map((id) => {
      const files = state.built.filter((b) => b.pipeline === id);
      const built = files.flatMap((b) => (b.result.ok ? [b.result.ast] : []));
      return {
        pipeline: id,
        scripts: files.length,
        built: built.length,
        nodes: built.reduce((n, ast) => n + countNodes(ast), 0),
        comments: built.reduce((n, ast) => n + ast.comments.length, 0),
        builderErrors: files.reduce(
          (n, b) => n + (b.result.ok ? b.result.errors.length : 0),
          0,
        ),
        ms: files.reduce((n, b) => n + b.ms, 0),
      };
    });
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(
      join(REPORTS, "ast-corpus.json"),
      `${JSON.stringify({ rows }, null, 2)}\n`,
    );
    writeFileSync(
      join(REPORTS, "ast-corpus.md"),
      [
        "# Corpus AST report (F-102)",
        "",
        "| Pipeline | Scripts | Built | Nodes | Comments | Builder errors | Build ms |",
        "|---|---|---|---|---|---|---|",
        ...rows.map(
          (r) =>
            `| ${r.pipeline} | ${r.scripts} | ${r.built} | ${r.nodes} | ${r.comments} | ${r.builderErrors} | ${r.ms.toFixed(0)} |`,
        ),
        "",
        `Comment attachment against nf-lang 26.10.7 (CommentDump.java): ${state.comparison.compared} of ${state.comparison.upstream} comments agree on slot and anchor, ${state.comparison.labelStart} of them on a label-prefixed statement (its range starts at the label, ADR 0027).`,
        "",
      ].join("\n"),
    );
    expect(rows).toHaveLength(IDS.length);
  });
});
