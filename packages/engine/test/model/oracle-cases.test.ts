import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IncludeRules, SourceParser } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { installedPacks, installedPackVersions } from "../../src/packs";
import { loadParser } from "../../src/source/parser";
import { modelAll } from "./describe";
import { readTree } from "./read-tree";

const cases = fileURLToPath(
  new URL("../../../../tools/oracle/cases/", import.meta.url),
);

let parser: SourceParser;
let rules: IncludeRules;
beforeAll(async () => {
  const version = installedPackVersions()[0] as string;
  parser = await loadParser(version);
  rules = (
    installedPacks.find((p) => p.version === version) as {
      includes: IncludeRules;
    }
  ).includes;
});

interface Manifest {
  cases: { id: string; lint?: { errors?: string[] } }[];
}
const manifest = parse(readFileSync(`${cases}cases.yaml`, "utf8")) as Manifest;
const recordedErrors = (id: string) =>
  manifest.cases.find((c) => c.id === id)?.lint?.errors ?? [];

describe("oracle cases f105-includes-*", () => {
  it("F-105 step 1: every error the oracle records for f105-includes-missing is one of our diagnostics, at lint's position", () => {
    const models = modelAll(
      readTree(`${cases}f105-includes-missing`),
      parser,
      rules,
    );
    const ours = [...models.values()].flatMap((m) => m.diagnostics);
    const recorded = recordedErrors("f105-includes-missing");
    expect(recorded.length).toBe(7);
    for (const text of recorded) {
      expect(
        ours.filter((d) => d.message.includes(text)).length,
        text,
      ).toBeGreaterThan(0);
    }
    // positions as `nextflow lint` reports them (oracle report, 26.10.7)
    expect(
      ours.map((d) => `${d.path} ${d.range.line}:${d.range.column} ${d.code}`),
    ).toEqual([
      "conf/inc.config 2:1 include-target",
      "conf/inc.config 4:12 include-target",
      "main.nf 2:1 include-target",
      "main.nf 3:1 include-name",
      "main.nf 4:1 include-target",
      "main.nf 5:1 include-not-parsed",
      "main.nf 6:1 include-target",
    ]);
    // lint also reports the grammar error of the target that could not be parsed
    const q = models.get("pipelines/q.nf");
    expect(
      q?.source.problems.map((p) => [p.source, p.line, p.column, p.message]),
    ).toContainEqual([
      expect.stringMatching(/lexer|parser/),
      2,
      1,
      "Unexpected end of file -- check for an unclosed brace, bracket, parenthesis, or string",
    ]);
  });

  it("F-105 step 1: f105-includes-resolve has no diagnostics and every include resolves", () => {
    const models = modelAll(
      readTree(`${cases}f105-includes-resolve`),
      parser,
      rules,
    );
    const all = [...models.values()];
    expect(all.flatMap((m) => m.diagnostics)).toEqual([]);
    const includes = all.flatMap((m) => m.includes);
    expect(includes.length).toBeGreaterThanOrEqual(13);
    expect(includes.filter((i) => i.target.kind === "missing")).toEqual([]);
    expect(
      includes.filter((i) => i.kind === "script").map((i) => i.target.kind),
    ).toContain("plugin");
    expect(
      includes.filter(
        (i) => i.kind === "config" && i.target.kind === "external",
      ),
    ).toHaveLength(1);
    for (const i of includes)
      if (i.kind === "script" && i.target.kind === "file")
        for (const e of i.entries)
          expect(e.declaration, e.entry.name.name).not.toBeNull();
  });
});
