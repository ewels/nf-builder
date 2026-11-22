// Printer fixtures (F-110, ADR 0005, LA-45): the printer must print each input as `nextflow lint -format` formats it
// (formatted*/, written by `pnpm oracle --write-format`). Until the declarations are ported, the run is limited to the
// files that hold only statements and functions, listed below; that list and KNOWN go when they are.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import { createLayout, printScript } from "../../src/printer/index.ts";
import { commentTexts } from "./comment-texts.ts";

const root = join(import.meta.dirname, "..");
const read = (...path: string[]) => readFileSync(join(root, ...path), "utf8");

/** `ast` tree files that are code snippets or functions, and print as lint -format formats them. */
const PRINTED = [
  "comments.nf",
  "shebang.nf",
  "function.nf",
  "stmt-separators.nf",
  "stmt-variable-declaration.nf",
  "stmt-assignment.nf",
  "stmt-expression.nf",
  "stmt-assert.nf",
  "stmt-if-else.nf",
  "stmt-return.nf",
  "stmt-throw.nf",
  "stmt-try-catch-legacy.nf",
  "stmt-empty.nf",
  "expr-literals.nf",
  "expr-strings.nf",
  "expr-gstrings.nf",
  "expr-collections.nf",
  "expr-closures.nf",
  "expr-index-property.nf",
  "expr-calls.nf",
  "expr-operators.nf",
];

/** Files whose printed text differs from lint -format's in one line (the manifest's known differences). */
const KNOWN: Record<
  string,
  { id: string; printed: string; formatted: string }
> = {
  "stmt-try-catch.nf": {
    id: "catch-package",
    printed: "catch (e: java.nio.file.AccessDeniedException) {",
    formatted: "catch (e: AccessDeniedException) {",
  },
  "expr-constructor.nf": {
    id: "type-rename",
    printed: "def list = new ArrayList<String>()",
    formatted: "def list = new List<String>()",
  },
};

function print(text: string) {
  const parsed = parseScriptAst(text);
  expect(parsed.ok && parsed.errors).toEqual([]);
  if (!parsed.ok) throw new Error("parse failed");
  return printScript(parsed.ast, { layout: createLayout(text) });
}

describe("printer fixtures", () => {
  for (const path of PRINTED) {
    const input = read("ast/fixtures", path);
    const formatted = read("printer/formatted-ast", path);

    it(`F-110 step 1 LA-45 ADR-0005: ast/${path} prints as nextflow lint -format formats it`, () => {
      const result = print(input);
      expect(result.text).toBe(formatted);
      expect(result.missingComments).toEqual([]);
    });

    it(`F-110 LA-45: printing ast/${path} again changes nothing`, () => {
      expect(print(formatted).text).toBe(formatted);
    });

    it(`F-110 LA-45: ast/${path} keeps every comment`, () => {
      expect(commentTexts(print(input).text)).toEqual(commentTexts(input));
    });

    it(`F-110 step 2: ast/${path} as printed parses with no errors`, () => {
      expect(parseScriptAst(print(input).text)).toMatchObject({
        ok: true,
        errors: [],
      });
    });
  }

  for (const [path, known] of Object.entries(KNOWN)) {
    const input = read("ast/fixtures", path);
    const formatted = read("printer/formatted-ast", path);

    it(`F-110 step 1 ADR-0005: ast/${path} differs from lint -format only as ${known.id} says`, () => {
      const text = print(input).text;
      expect(formatted).toContain(known.formatted);
      expect(text).not.toBe(formatted);
      expect(text).toBe(formatted.replace(known.formatted, known.printed));
    });

    it(`F-110 step 2: ast/${path} as printed parses with no errors and prints again unchanged`, () => {
      const text = print(input).text;
      expect(parseScriptAst(text)).toMatchObject({ ok: true, errors: [] });
      expect(print(text).text).toBe(text);
    });
  }
});
