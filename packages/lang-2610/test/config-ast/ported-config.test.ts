import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";

type PortedCase = {
  id: string;
  file: string;
  test: string;
  owner?: string;
  lint: { line: number; column: number; message: string }[];
};
const ported = join(import.meta.dirname, "../ported");
const all = (
  JSON.parse(readFileSync(join(ported, "cases.json"), "utf8")) as {
    cases: PortedCase[];
  }
).cases;
const cases = all.filter((c) => c.owner === "F-103");

// [id, start, end] of the invalid statement or escape, from nextflow lint 26.10.7 and nf-lang's ranges
const RANGES: Record<string, string> = {
  "ConfigAstBuilderTest-L059": "1:1-6:2",
  "ConfigAstBuilderTest-L076": "3:9-8:10",
  "ConfigAstBuilderTest-L097": "1:1-5:2",
  "ConfigAstBuilderTest-L113": "1:1-5:2",
  "ConfigAstBuilderTest-L129": "1:1-1:63",
  "ConfigAstBuilderTest-L163": "1:14-1:16",
  "ConfigAstBuilderTest-L175": "1:28-1:30",
};

// the cases whose statement is an if, try or `def`, which the AST keeps as ConfigInvalid
const INVALID_STATEMENTS = new Set([
  "ConfigAstBuilderTest-L059",
  "ConfigAstBuilderTest-L076",
  "ConfigAstBuilderTest-L097",
  "ConfigAstBuilderTest-L113",
  "ConfigAstBuilderTest-L129",
]);

describe("F-103 FI-01: the config builder reproduces the ported ConfigAstBuilderTest errors", () => {
  it("F-103: exactly the seven ConfigAstBuilderTest inputs are owned by F-103", () => {
    expect(cases.map((c) => c.id).sort()).toEqual(Object.keys(RANGES).sort());
  });

  for (const c of cases) {
    it(`F-103 FI-01 LA-30: ${c.id} (${c.test}) reports ${c.lint[0]?.message} at ${c.lint[0]?.line}:${c.lint[0]?.column}`, () => {
      const result = parseConfigAst(readFileSync(join(ported, c.file), "utf8"));
      expect(result.ok).toBe(true);
      expect(
        result.errors.map((e) => ({
          line: e.line,
          column: e.column,
          message: e.message,
        })),
      ).toEqual(c.lint);
      const e = result.errors[0];
      expect(`${e?.line}:${e?.column}-${e?.endLine}:${e?.endColumn}`).toBe(
        RANGES[c.id],
      );
      // the invalid statements are kept in the AST
      if (INVALID_STATEMENTS.has(c.id))
        expect(JSON.stringify(result.ok && result.ast)).toContain(
          '"ConfigInvalid"',
        );
    });
  }
});

describe("F-103 FI-01: the ported ConfigAstBuilderTest cases F-103 does not own", () => {
  const other = (id: string): PortedCase => {
    const found = all.find((c) => c.id === id);
    if (!found) throw new Error(`no ported case ${id}`);
    return found;
  };

  it("F-103 FI-01: ConfigAstBuilderTest-L188 (octal escape \\101) builds with no errors", () => {
    const c = other("ConfigAstBuilderTest-L188");
    expect(c.lint).toEqual([]);
    const result = parseConfigAst(readFileSync(join(ported, c.file), "utf8"));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  for (const id of ["ConfigAstBuilderTest-L044", "ConfigAstBuilderTest-L143"]) {
    it(`F-103 FI-01: ${id} stops at the recorded parser error`, () => {
      const c = other(id);
      const result = parseConfigAst(readFileSync(join(ported, c.file), "utf8"));
      expect(result.ok).toBe(false);
      expect(
        result.errors.map((e) => ({
          source: e.source,
          line: e.line,
          column: e.column,
          message: e.message,
        })),
      ).toEqual(c.lint.map((e) => ({ source: "parser", ...e })));
    });
  }
});
