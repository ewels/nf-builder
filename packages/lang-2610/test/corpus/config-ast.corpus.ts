// F-103 steps 1 and 2: build the config AST of every config in the pinned corpus, compare it with the committed
// statement-level snapshot (step 1), and check that every node and comment range slices back to its exact source, by
// re-parsing every statement and value (step 2). Run by `pnpm test:corpus` after `pnpm corpus:fetch`;
// `pnpm test:corpus config-ast -u` rewrites the snapshots after an intended AST change or a pin bump.
// Reads .cache/corpus by path; imports nothing from tools/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AstNode } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";
import { anchors, attachments, type Row } from "../ast/comment-anchors.ts";
import { checkConfigRanges } from "../config-ast/check-config-ranges.ts";
import { renderConfigAst, snapshotPath } from "./config-snapshot.ts";
import { listSources } from "./corpus-files.ts";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const SNAPSHOTS = join(import.meta.dirname, "snapshots/config");

const ids = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

const configs = ids.flatMap((id) =>
  existsSync(join(CORPUS, id))
    ? listSources(join(CORPUS, id))
        .filter((s) => s.kind === "config")
        .map((s) => ({
          id,
          path: s.path,
          text: readFileSync(join(CORPUS, id, s.path), "utf8"),
        }))
    : [],
);
const LINT = join(ROOT, ".cache/corpus-lint");
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
const dumps = new Map(
  ids.flatMap((id) => {
    const file = join(LINT, `${id}.comments.json`);
    return existsSync(file)
      ? [[id, JSON.parse(readFileSync(file, "utf8")) as Dump] as const]
      : [];
  }),
);
const built = new Map(
  configs.map((c) => [`${c.id}/${c.path}`, parseConfigAst(c.text)] as const),
);

describe("F-103 step 1: the corpus configs build config ASTs", () => {
  it("F-103 step 1: every pinned pipeline is present", () => {
    const missing = ids.filter((id) => !existsSync(join(CORPUS, id)));
    expect(missing, "run pnpm corpus:fetch").toEqual([]);
  });

  it("F-103 step 1 FI-01: every corpus config builds an AST with no AST errors", () => {
    expect(configs.length).toBeGreaterThan(200);
    const bad = [...built]
      .filter(([, r]) => !r.ok || r.errors.length > 0)
      .map(([name, r]) => `${name}: ${r.errors[0]?.message}`);
    expect(bad).toEqual([]);
  });

  for (const c of configs) {
    it(`F-103 step 1 FI-01 FI-05: ${c.id}/${c.path} matches its statement-level snapshot`, async () => {
      const result = built.get(`${c.id}/${c.path}`);
      if (!result?.ok) throw new Error("does not build");
      await expect(
        renderConfigAst(result.ast, result.errors),
      ).toMatchFileSnapshot(snapshotPath(c.id, c.path));
    });
  }

  it("F-103 step 1: every nextflow.config and conf/ config is snapshotted, and no snapshot is stale", () => {
    const wanted = configs.filter((c) =>
      /(^|\/)nextflow\.config$|(^|\/)conf\/.+\.config$/.test(c.path),
    );
    expect(wanted.length).toBeGreaterThanOrEqual(184);
    const files = (dir: string, prefix = ""): string[] =>
      readdirSync(dir).flatMap((name) =>
        statSync(join(dir, name)).isDirectory()
          ? files(join(dir, name), `${prefix}${name}/`)
          : [`${prefix}${name}`],
      );
    const have = new Set(files(SNAPSHOTS));
    const expected = new Set(
      configs.map((c) =>
        snapshotPath(c.id, c.path).replace("snapshots/config/", ""),
      ),
    );
    const stale = [...have].filter((f) => !expected.has(f));
    expect(stale, "delete the stale snapshots").toEqual([]);
    expect(
      wanted
        .map((c) => snapshotPath(c.id, c.path).replace("snapshots/config/", ""))
        .filter((f) => !have.has(f)),
    ).toEqual([]);
  });
});

describe("F-103 step 2: ranges", () => {
  it("F-103 step 2 AR-01: every node and comment range of every corpus config slices back to its exact source", () => {
    const problems: string[] = [];
    for (const c of configs) {
      const result = built.get(`${c.id}/${c.path}`);
      if (!result?.ok) continue;
      for (const p of checkConfigRanges(result.ast, c.text, { reparse: true }))
        problems.push(`${c.id}/${c.path}: ${p}`);
    }
    expect(problems.slice(0, 50)).toEqual([]);
  }, 300_000);

  it("F-103 step 2: the root lists every comment of every corpus config", () => {
    let comments = 0;
    for (const c of configs) {
      const result = built.get(`${c.id}/${c.path}`);
      if (!result?.ok) continue;
      comments += result.ast.comments.length;
    }
    expect(comments).toBeGreaterThan(700);
  });

  it("F-103 step 2 AR-02: corpus config comment attachment matches nf-lang 26.10.7", () => {
    const differences: string[] = [];
    let compared = 0;
    let upstream = 0;
    for (const c of configs) {
      const result = built.get(`${c.id}/${c.path}`);
      const file = dumps.get(c.id)?.files.find((f) => f.file === c.path);
      if (!result?.ok || !file?.comments) continue; // rejected upstream too
      upstream += file.comments.length;
      const ours = attachments(result.ast);
      const where = `${c.id}/${c.path}`;
      const keys = file.comments.map((r) => `${r.line}:${r.column}`).sort();
      if (JSON.stringify([...ours.keys()].sort()) !== JSON.stringify(keys)) {
        differences.push(`${where}: the attached comments differ`);
        continue;
      }
      for (const dumped of file.comments) {
        const key = `${dumped.line}:${dumped.column}`;
        const mine = (ours.get(key) ?? [])[0];
        const row: Row = {
          line: dumped.line,
          column: dumped.column,
          slot: dumped.slot,
          anchor: dumped.node.class,
          from: [dumped.node.line, dumped.node.column],
          to: [dumped.node.endLine, dumped.node.endColumn],
          text: dumped.text,
        };
        if (!mine) differences.push(`${where} ${key}: not attached`);
        else if (mine.slot !== row.slot)
          differences.push(
            `${where} ${key}: slot ${mine.slot}, nf-lang ${row.slot}`,
          );
        else if (!anchors(row, mine.node as AstNode & Record<string, unknown>))
          differences.push(
            `${where} ${key}: anchor ${mine.node.kind}@${mine.node.range.line}:${mine.node.range.column}-${mine.node.range.endLine}:${mine.node.range.endColumn}, nf-lang ${row.anchor}@${row.from}-${row.to}`,
          );
        else compared++;
      }
    }
    expect(differences.slice(0, 20)).toEqual([]);
    expect(compared).toBe(upstream);
    expect(compared).toBeGreaterThan(700);
  });
});
