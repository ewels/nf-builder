// F-103 steps 1 and 2: build the config AST of every config in the pinned corpus, compare it with the committed
// statement-level snapshot (step 1), and check that every node and comment range slices back to its exact source, by
// re-parsing every statement and value (step 2). Run by `pnpm test:corpus` after `pnpm corpus:fetch`;
// `pnpm test:corpus config-ast -u` rewrites the snapshots after an intended AST change or a pin bump.
// Reads .cache/corpus by path; imports nothing from tools/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";
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
});
