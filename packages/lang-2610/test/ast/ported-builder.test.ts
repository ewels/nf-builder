import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const ported = (path: string) =>
  readFileSync(join(dir, "../ported", path), "utf8");

type Located = { line: number; column: number; message: string };
type PortedCase = {
  id: string;
  file: string;
  test: string;
  layer: "lexer" | "parser" | "reparse" | "ast-builder" | "resolve";
  owner?: "F-102" | "F-103" | "F-112";
  expect: { ok: true } | ({ ok: false } & Located);
  lint: Located[];
};
const cases = (
  JSON.parse(ported("cases.json")) as { cases: PortedCase[] }
).cases.filter((c) => c.file.endsWith(".nf"));

const located = (errors: readonly Located[]): Located[] =>
  errors.map(({ line, column, message }) => ({ line, column, message }));
const withoutResolver = (lint: Located[]) =>
  lint.filter((e) => !e.message.endsWith("is not defined"));

describe("F-102 ported nf-lang builder cases", () => {
  for (const c of cases.filter((c) => c.owner === "F-102")) {
    it(`F-102 LA-30 ADR-0005: ${c.id} (${c.test}) reports nf-lang's ${c.layer} error`, () => {
      const result = parseScriptAst(ported(c.file));
      expect(located(result.errors)).toEqual(withoutResolver(c.lint));
    });
  }

  it("F-102 ADR-0005: every other ported script case builds with no builder errors", () => {
    const others = cases.filter((c) => c.owner !== "F-102");
    expect(others.length).toBeGreaterThan(40);
    for (const c of others) {
      const result = parseScriptAst(ported(c.file));
      if (c.expect.ok) {
        // owner F-112 cases fail only in the resolver
        expect(result.ok, c.id).toBe(true);
        expect(located(result.errors), c.id).toEqual([]);
      } else {
        expect(result.ok, c.id).toBe(false);
        expect(located(result.errors), c.id).toEqual([
          {
            line: c.expect.line,
            column: c.expect.column,
            message: c.expect.message,
          },
        ]);
      }
    }
  });

  it("F-102 ADR-0005: the AST builder rejects the three corpus fixtures nextflow lint rejects after parsing", () => {
    const fixture = (name: string) =>
      readFileSync(
        join(dir, "../../../../tools/corpus/fixtures", name),
        "utf8",
      );
    const section = parseScriptAst(fixture("section-order.nf"));
    expect(located(section.errors)).toEqual([
      { line: 8, column: 10, message: "Unexpected input: ':'" },
    ]);
    expect(section.ok).toBe(true);
    if (section.ok)
      expect(
        section.ast.body.filter((i) => i.kind === "InvalidDeclaration"),
      ).toHaveLength(1);

    expect(
      located(parseScriptAst(fixture("typed-legacy-mixed.nf")).errors),
    ).toEqual([
      {
        line: 19,
        column: 5,
        message: "Invalid input declaration in typed process",
      },
    ]);
    expect(
      located(parseScriptAst(fixture("typed-without-flag.nf")).errors),
    ).toEqual([
      {
        line: 4,
        column: 5,
        message:
          "Typed input declaration is not allowed in legacy process -- set `nextflow.enable.types = true` to use typed processes in this script",
      },
    ]);
  });

  it("F-102 AR-01: the parse result carries the AST, the comment map and the parse status", () => {
    const comments = parseScriptAst(
      readFileSync(join(dir, "fixtures/comments.nf"), "utf8"),
    );
    expect(comments.ok).toBe(true);
    if (comments.ok) {
      expect(comments.errors).toEqual([]);
      expect(comments.ast.comments.map((c) => c.text)).toEqual([
        "// line comment",
        "/*\n * block comment\n */",
      ]);
    }
    const shebang = parseScriptAst(
      readFileSync(join(dir, "fixtures/shebang.nf"), "utf8"),
    );
    expect(shebang.ok).toBe(true);
    if (shebang.ok) {
      expect(shebang.ast.shebang?.kind).toBe("shebang");
      expect(shebang.ast.comments).toEqual([]);
    }
    const withError = parseScriptAst("def _ = 1\n");
    expect(withError.ok).toBe(true);
    expect(withError.errors).not.toEqual([]);
    expect(parseScriptAst("println (\n").ok).toBe(false);
  });
});
