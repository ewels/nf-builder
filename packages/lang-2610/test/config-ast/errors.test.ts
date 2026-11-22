import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";

const dir = join(
  import.meta.dirname,
  "../../../../tools/oracle/cases/config-ast-errors",
);

// `nextflow lint -o json` 26.10.7 (NXF_SYNTAX_PARSER=v2, offline), 2026-11-22, on each file of the oracle case
// config-ast-errors; `pnpm oracle --case config-ast-errors` checks the messages in CI. Each row: line, column, message.
const lint: Record<string, [number, number, string][]> = {
  "p01-apply-not-plugins.config": [
    [1, 1, "Config settings must be assigned with an equals sign (`=`)"],
  ],
  "p02-incomplete.config": [[1, 1, "Incomplete statement"]],
  "p03-incomplete-in-block.config": [[2, 5, "Incomplete statement"]],
  "p04-incomplete-dot.config": [[1, 1, "Incomplete statement"]],
  "p06-invalid-assign-target.config": [
    [
      1,
      22,
      "Invalid assignment target -- must be a variable, index, or property expression",
    ],
  ],
  "p07-empty-list-comma.config": [
    [1, 13, "Empty list literal should not contain any comma(,)"],
  ],
  "p09-nested-paren.config": [
    [
      1,
      22,
      "Nested parenthesis is not allowed in multiple assignment, e.g. ((a)) = b",
    ],
  ],
  "p10-number-format.config": [
    [
      1,
      12,
      "Number of value 99999999999 does not fit in the range of int, but int was enforced.",
    ],
  ],
  "p17-two-escapes.config": [
    [1, 14, "Invalid escape sequence: '\\q'"],
    [1, 23, "Invalid escape sequence: '\\.'"],
  ],
  "p18-two-invalid.config": [
    [1, 1, "If statements cannot be mixed with config statements"],
    [2, 1, "Variable declarations cannot be mixed with config statements"],
  ],
  // a fatal error ends the build: the second `[,]` is not reported
  "p19-two-fatal.config": [
    [
      1,
      22,
      "Invalid assignment target -- must be a variable, index, or property expression",
    ],
  ],
  // the number-format error is held to the end and comes out after the escape error's line
  "q01-numfmt-then-escape.config": [
    [
      1,
      12,
      "Number of value 99999999999 does not fit in the range of int, but int was enforced.",
    ],
    [2, 14, "Invalid escape sequence: '\\q'"],
  ],
  // names in paths, blocks and selectors are not checked for escapes; only the value on line 5 is
  "q03-escapes-in-names.config": [[5, 7, "Invalid escape sequence: '\\q'"]],
  // an escape before a fatal error is reported, one after it is not
  "q02-escape-fatal-escape.config": [
    [1, 14, "Invalid escape sequence: '\\q'"],
    [
      2,
      22,
      "Invalid assignment target -- must be a variable, index, or property expression",
    ],
  ],
};

describe("F-103 FI-01: the config builder reports nextflow lint 26.10.7's errors", () => {
  for (const [file, expected] of Object.entries(lint)) {
    it(`F-103 FI-01 LA-30: ${file} reports ${expected.map((e) => `${e[0]}:${e[1]}`).join(", ")}`, () => {
      const result = parseConfigAst(readFileSync(join(dir, file), "utf8"));
      expect(result.errors.map((e) => [e.line, e.column, e.message])).toEqual(
        expected,
      );
      expect(result.errors.every((e) => e.source === "builder")).toBe(true);
    });
  }

  it("F-103 FI-01: every file of the oracle case is covered here", () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(lint).sort());
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
    expect(errors('x = "a ${y}\\q"')).toEqual([
      "Invalid escape sequence: '\\q'",
    ]);
  });
});
