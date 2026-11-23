import { describe, expect, it } from "vitest";
import {
  DEFAULT_IGNORE,
  isIgnored,
  parseIgnore,
} from "../../src/import/ignore";

const ignored = (text: string, ...paths: string[]) => {
  const list = parseIgnore(text);
  return paths.map((p) => isIgnored(list, p));
};

describe("import ignore list", () => {
  it("F-403 IO-12: the default list ignores run output, .git/, node_modules/, __MACOSX/ and .DS_Store at any depth, and /data/, /testing/ and /test-datasets/ at the top only", () => {
    const list = parseIgnore(DEFAULT_IGNORE);
    expect(list.problems).toEqual([]);
    for (const p of [
      "work/ab/cd.txt",
      "sub/work/x",
      "results/a.html",
      "null/x",
      ".nextflow.log",
      ".nextflow/cache/x",
      ".nf-test/x",
      ".nf-test.log",
      ".lineage/x",
      "data/ggal/gut_1.fq",
      "testing/x.nf",
      "test-datasets/a",
      ".git/config",
      "a/.git/config",
      "node_modules/x/y.js",
      "__MACOSX/._a.nf",
      ".DS_Store",
      "a/b/.DS_Store",
    ])
      expect(isIgnored(list, p), p).toBe(true);
    for (const p of [
      "main.nf",
      "modules/x/data/a.nf",
      "modules/testing/a.nf",
      ".nf-builder/layout.json",
      "assets/test/a.fastq",
      "data.nf",
      "workflows/work.nf",
    ])
      expect(isIgnored(list, p), p).toBe(false);
  });

  it("F-403 IO-12: name patterns match at any depth, anchored ones from the top; a trailing slash matches folders only; * and ? stay in a folder; ** crosses folders", () => {
    expect(ignored("*.log", "a.log", "x/y/a.log", "a.logx")).toEqual([
      true,
      true,
      false,
    ]);
    expect(ignored("/a.log", "a.log", "x/a.log")).toEqual([true, false]);
    expect(ignored("x/a.log", "x/a.log", "y/x/a.log")).toEqual([true, false]);
    expect(ignored("tmp/", "tmp/a", "a/tmp/b", "tmp", "a/tmp")).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(ignored("a*b", "axb", "a/b", "axxb")).toEqual([true, false, true]);
    expect(ignored("a?c", "abc", "a/c", "abbc")).toEqual([true, false, false]);
    expect(
      ignored("/a/**/c.nf", "a/c.nf", "a/b/c.nf", "a/b/d/c.nf", "x/a/c.nf"),
    ).toEqual([true, true, true, false]);
    expect(ignored("**/c.nf", "c.nf", "a/b/c.nf")).toEqual([true, true]);
    expect(ignored("/a/**", "a/b", "a/b/c")).toEqual([true, true]);
    expect(ignored("a.b", "a.b", "axb")).toEqual([true, false]);
    expect(ignored("Data/", "data/x", "Data/x")).toEqual([false, true]);
  });

  it("F-403 IO-12: blank and # lines are skipped; !, [ and \\ lines are problems with their line numbers and are not applied", () => {
    const list = parseIgnore(
      "# note\n\n  work/  \n!keep.nf\n[ab].nf\nx\\y\n*.log\n",
    );
    expect(list.rules.map((r) => r.line)).toEqual([3, 7]);
    expect(list.problems.map((p) => [p.line, p.text])).toEqual([
      [4, "!keep.nf"],
      [5, "[ab].nf"],
      [6, "x\\y"],
    ]);
    for (const p of list.problems) expect(p.message).toBeTruthy();
    expect(isIgnored(list, "keep.nf")).toBe(false);
    expect(isIgnored(list, "work/a")).toBe(true);
  });
});
