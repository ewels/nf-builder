import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compare,
  type FileOutcome,
  type KnownDifference,
  LINT_EXCLUDES,
  listSources,
  loadKnownDifferences,
} from "./corpus/corpus-files.ts";

const temp = () => mkdtempSync(join(tmpdir(), "corpus-files-"));
const put = (root: string, file: string) => {
  const path = join(root, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
};

describe("corpus files", () => {
  it("F-006 step 2: corpus file listing mirrors nextflow lint's default excludes", () => {
    expect(LINT_EXCLUDES).toEqual([
      ".git",
      ".lineage",
      ".nextflow",
      ".nf-test",
      "nf-test.config",
      "work",
    ]);
    const root = temp();
    for (const file of [
      "main.nf",
      "nextflow.config",
      "modules/a.nf",
      "conf/base.config",
      ".git/hooks/x.nf",
      ".nf-test/tests/y.nf",
      "work/ab/z.nf",
      "nf-test.config",
      "tests/x.nf.test",
      "README.md",
    ])
      put(root, file);
    expect(listSources(root)).toEqual([
      { path: "conf/base.config", kind: "config" },
      { path: "main.nf", kind: "script" },
      { path: "modules/a.nf", kind: "script" },
      { path: "nextflow.config", kind: "config" },
    ]);
  });

  const known: KnownDifference[] = [
    {
      pipeline: "fixtures",
      file: "a.nf",
      lint: "error",
      parser: "ok",
      cause: "semantic check",
    },
  ];
  const outcome = (
    file: string,
    parser: "ok" | "error",
    pipeline = "fixtures",
  ): FileOutcome => ({ pipeline, file, parser });

  it("F-006 step 2: compare reports unexpected and stale differences, and requires a cause", () => {
    const lint = new Map([["fixtures", new Set(["a.nf", "c.nf"])]]);
    // a.nf: listed difference. b.nf: lint accepts, parser rejects. c.nf: both reject. d.nf: both accept.
    const result = compare(
      [
        outcome("a.nf", "ok"),
        outcome("b.nf", "error"),
        outcome("c.nf", "error"),
        outcome("d.nf", "ok"),
      ],
      lint,
      known,
    );
    expect(result.listed.map((d) => d.file)).toEqual(["a.nf"]);
    expect(
      result.unexpected.map(
        (d) => `${d.file} lint=${d.lint} parser=${d.parser}`,
      ),
    ).toEqual(["b.nf lint=ok parser=error"]);
    expect(result.stale).toEqual([]);

    const stale = compare([outcome("a.nf", "error")], lint, known);
    expect(stale.stale).toEqual(known);
    expect(stale.unexpected).toEqual([]);

    const file = join(temp(), "k.json");
    writeFileSync(file, JSON.stringify(known));
    expect(loadKnownDifferences(file)).toEqual(known);
    writeFileSync(file, JSON.stringify([{ ...known[0], cause: " " }]));
    expect(() => loadKnownDifferences(file)).toThrow(/cause/);
    writeFileSync(file, JSON.stringify([{ ...known[0], lint: "maybe" }]));
    expect(() => loadKnownDifferences(file)).toThrow(/lint/);
  });
});
