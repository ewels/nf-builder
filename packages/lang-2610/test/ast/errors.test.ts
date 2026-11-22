import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkEscapes, numberError } from "../../src/ast/build/literals.ts";
import { parseScriptAst } from "../../src/ast/index.ts";
import { checkRanges } from "./check-ranges.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(dir, path), "utf8");

type Located = { line: number; column: number; message: string };
type ErrorCase = {
  id: string;
  file: string;
  upstream: string;
  fatal: boolean;
  lint: Located[];
  expect: Located[];
  note?: string;
};
const manifest = JSON.parse(read("errors.json")) as { cases: ErrorCase[] };

const located = (errors: readonly Located[]): Located[] =>
  errors.map(({ line, column, message }) => ({ line, column, message }));

describe("F-102 builder errors (nf-lang ScriptAstBuilder)", () => {
  for (const c of manifest.cases) {
    const first = c.expect[0] as Located;
    it(`F-102 LA-30 ADR-0005: ${c.id} reports ${first.message} at ${first.line}:${first.column}`, () => {
      const text = read(c.file);
      const result = parseScriptAst(text);
      expect(result.ok).toBe(!c.fatal);
      expect(located(result.errors)).toEqual(c.expect);
      if (result.ok)
        expect(
          checkRanges(result.ast, text, {
            reparse: "declarations",
            attached: true,
          }),
        ).toEqual([]);
    });
  }

  it("F-102 ADR-0005: every lint-clean fixture builds with no builder errors", () => {
    const fixtures = JSON.parse(read("fixtures.json")) as {
      fixtures: { file: string }[];
    };
    for (const { file } of fixtures.fixtures) {
      const result = parseScriptAst(read(`fixtures/${file}`));
      expect({ file, ok: result.ok, errors: located(result.errors) }).toEqual({
        file,
        ok: true,
        errors: [],
      });
    }
  });

  it("F-102 LA-30: a legacy parameter with types enabled reports the params-block message (nextflow lint 26.10.7 crashes on it)", () => {
    const result = parseScriptAst(
      "nextflow.enable.types = true\n\nparams.input = 'x'\n",
    );
    expect(result.ok).toBe(true);
    expect(located(result.errors)).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "Legacy parameter is not allowed with `nextflow.enable.types = true` -- use the `params` block instead",
      },
    ]);
    if (result.ok)
      expect(result.ast.body.map((item) => item.kind)).toEqual(["FeatureFlag"]);
  });

  it("F-102 LA-30: invalid escapes are reported at the escape, in UTF-16 columns as nf-lang does", () => {
    const at = (text: string, slashy = false) =>
      checkEscapes(text, 1, 1, slashy).map((e) => [
        e.line,
        e.column,
        e.message,
      ]);
    expect(at("'a\\qb'")).toEqual([[1, 3, "Invalid escape sequence: '\\q'"]]);
    expect(at("'\\u00e9 \\n \\101 \\$'")).toEqual([]);
    expect(at("'\\uZZZZ'")).toEqual([[1, 2, "Invalid escape sequence: '\\u'"]]);
    expect(at("'\\u12'")).toEqual([[1, 2, "Invalid escape sequence: '\\u'"]]);
    expect(at("/a\\qb/", true)).toEqual([]);
    // a line continuation advances the line; the next escape is on line 2
    expect(at("'a\\\n  \\q'")).toEqual([
      [2, 3, "Invalid escape sequence: '\\q'"],
    ]);
    // columns count UTF-16 units: an astral character takes two
    expect(at("'𝐀\\q'")).toEqual([[1, 4, "Invalid escape sequence: '\\q'"]]);
    // the start position is the string's
    expect(
      checkEscapes("'\\q'", 4, 7, false).map((e) => [
        e.line,
        e.column,
        e.endLine,
        e.endColumn,
      ]),
    ).toEqual([[4, 8, 4, 10]]);
  });

  it("F-102 LA-30: integer literals with an i or l suffix must fit, as Groovy's Numbers.parseInteger checks", () => {
    expect(numberError("2147483647i", true)).toBeNull();
    expect(numberError("2147483648", true)).toBeNull();
    expect(numberError("2147483648i", true)).toBe(
      "Number of value 2147483648 does not fit in the range of int, but int was enforced.",
    );
    expect(numberError("9_223_372_036_854_775_808L", true)).toBe(
      "Number of value 9223372036854775808 does not fit in the range of long, but long was enforced.",
    );
    expect(numberError("9223372036854775807L", true)).toBeNull();
    // hex, octal and binary wrap instead of failing
    expect(numberError("0xFFFFFFFFFi", true)).toBeNull();
    expect(numberError("99999999999999999999g", true)).toBeNull();
    expect(numberError("1e999d", false)).toBe("out of range");
    expect(numberError("3.4028236e38f", false)).toBe("out of range");
    expect(numberError("3.4028235e38f", false)).toBeNull();
    expect(numberError("1e999", false)).toBeNull();
    expect(numberError("1.5", false)).toBeNull();
  });

  it("F-102 LA-30: a nested closure's and a gstring's invalid escapes are all reported, in source order", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Nextflow source with a gstring interpolation
    const source = "x = \"a\\q${ 'b\\r\\z' }\"\ny = { '\\y' }\n";
    const result = parseScriptAst(source);
    expect(result.ok).toBe(true);
    expect(result.errors.map((e) => `${e.line}:${e.column}`)).toEqual([
      "1:7",
      "1:16",
      "2:8",
    ]);
  });

  it("F-102 LA-30: a script with a builder error is ok with errors, and a parser error is not ok", () => {
    const built = parseScriptAst("def _ = 1\n");
    expect(built.ok).toBe(true);
    expect(built.errors).toHaveLength(1);
    expect(built.errors[0]?.source).toBe("builder");
    const failed = parseScriptAst("println (\n");
    expect(failed.ok).toBe(false);
    expect(failed.errors[0]?.source).toBe("parser");
  });

  it("F-102 LA-30: a parenthesised property or index is a valid assignment target; only nested parentheses around a name fail", () => {
    expect(parseScriptAst("(a.b) = 1\n(a[0]) = 2\n(a) = 3\n").errors).toEqual(
      [],
    );
    const nested = parseScriptAst("((a)) = 1\n");
    expect(nested.ok).toBe(false);
    expect(nested.errors[0]?.message).toMatch(/^Nested parenthesis/);
  });

  it("F-102 LA-30: a catch variable named like a keyword is reported once per caught type", () => {
    const result = parseScriptAst(
      "try { println 1 } catch (static: A | B) { println 2 }\n",
    );
    expect(
      result.errors.map((e) => `${e.line}:${e.column} ${e.message}`),
    ).toEqual([
      "1:26 `static` is not allowed as an identifier because it is a Groovy keyword",
      "1:26 `static` is not allowed as an identifier because it is a Groovy keyword",
    ]);
  });

  it("F-102: the errors manifest lists every input, cites the builder line, and expects lint's errors minus resolver errors", () => {
    const files = readdirSync(join(dir, "errors")).map((f) => `errors/${f}`);
    expect(manifest.cases.map((c) => c.file).sort()).toEqual(files.sort());
    expect(new Set(manifest.cases.map((c) => c.id)).size).toBe(
      manifest.cases.length,
    );
    for (const c of manifest.cases) {
      expect(c.upstream, c.id).toMatch(
        /ScriptAstBuilder\.java#L\d+(-L\d+)?(,L\d+(-L\d+)?)*$/,
      );
      const withoutResolver = c.lint.filter(
        (e) => !e.message.endsWith("is not defined"),
      );
      if (withoutResolver.some((e) => e.line === -1)) {
        // lint prints -1:-1 (an upstream bug), and the case's note says where we report instead; only the position differs
        expect(c.note, c.id).toBeTruthy();
        expect(
          c.expect.map((e) => e.message),
          c.id,
        ).toEqual(withoutResolver.map((e) => e.message));
        expect(withoutResolver.every((e) => e.line === -1)).toBe(true);
      } else {
        expect(c.expect, c.id).toEqual(withoutResolver);
      }
    }
  });
});
