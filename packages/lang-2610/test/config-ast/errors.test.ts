import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";

const pack = import.meta.dirname;

type Recorded = {
  cases: {
    file: string;
    lint: { line: number; column: number; message: string }[];
  }[];
};
// `nextflow lint -o json` 26.10.7 (NXF_SYNTAX_PARSER=v2, offline), 2026-11-22, on the tree errors/: the same file the
// oracle reads (`pnpm oracle` checks it in CI, positions included). A fatal builder error ends the build and the
// number-format error comes last, as in lint.
const recorded: Recorded = JSON.parse(
  readFileSync(join(pack, "errors.json"), "utf8"),
);

describe("F-103 FI-01: the config builder reports nextflow lint 26.10.7's errors", () => {
  for (const { file, lint } of recorded.cases) {
    it(`F-103 FI-01 LA-30: ${file} reports ${lint.map((e) => `${e.line}:${e.column}`).join(", ")}`, () => {
      const result = parseConfigAst(readFileSync(join(pack, file), "utf8"));
      const errors = result.errors.map((e) => ({
        line: e.line,
        column: e.column,
        message: e.message,
      }));
      expect(errors).toEqual(lint);
      expect(result.errors.every((e) => e.source === "builder")).toBe(true);
    });
  }

  it("F-103 FI-01: every file in errors/ is recorded", () => {
    expect(readdirSync(join(pack, "errors")).sort()).toEqual(
      recorded.cases.map((c) => c.file.replace("errors/", "")).sort(),
    );
  });

  it("F-103 FI-01: an invalid statement is reported alone and its inside is not checked, but a closure body is", () => {
    const run = (name: string) =>
      parseConfigAst(readFileSync(join(pack, "errors", name), "utf8"));
    // upstream never builds the statement, so a fatal `[,]` inside a `def` leaves it without one, and the build goes on
    const kept = run("r02-def-list-comma-then-escape.config");
    expect(kept.ok).toBe(true);
    expect(kept.ok && kept.ast.statements.map((s) => s.kind)).toEqual([
      "ConfigInvalid",
      "ConfigAssign",
    ]);
    expect(kept.ok && kept.ast.statements.map((s) => "statement" in s)).toEqual(
      [false, false],
    );
    expect(
      run("r01-if-escape-not-checked.config").errors.map((e) => e.message),
    ).toEqual(["If statements cannot be mixed with config statements"]);
    expect(run("r06-closure-body-checked.config").ok).toBe(false);
  });

  it("F-103 FI-01: integer literals follow Groovy's int and long ranges", () => {
    const errors = (text: string) =>
      parseConfigAst(text).errors.map((e) => e.message);
    expect(
      errors(
        "x = [2147483647i, 2147483648, 1_000i, 9223372036854775807L, 99999999999999999999]",
      ),
    ).toEqual([]);
    expect(errors("x = 2147483648i")).toEqual([
      "Number of value 2147483648 does not fit in the range of int, but int was enforced.",
    ]);
    expect(errors("x = 99999999999999999999L")).toEqual([
      "Number of value 99999999999999999999 does not fit in the range of long, but long was enforced.",
    ]);
  });

  it("F-103 FI-01: valid escapes and slashy strings give no error, and \\u needs four hex digits", () => {
    const errors = (text: string) =>
      parseConfigAst(text).errors.map((e) => e.message);
    expect(
      errors("x = 'a\\b\\t\\n\\f\\r\\s\\\"\\'\\\\\\$\\0\\7\\u00e9'"),
    ).toEqual([]);
    expect(errors("x = /a\\.b/")).toEqual([]);
    expect(errors("x = 'a\\uZZZZ'")).toEqual([
      "Invalid escape sequence: '\\u'",
    ]);
    expect(errors(`x = "a \${y}\\q"`)).toEqual([
      "Invalid escape sequence: '\\q'",
    ]);
  });
});
