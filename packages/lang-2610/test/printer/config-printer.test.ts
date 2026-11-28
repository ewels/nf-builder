// F-601 (ADR 0032): where the config printer deliberately keeps what `nextflow lint -format` drops, so that the
// printed file means what the source meant and still parses.
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";
import { createLayout, printConfig } from "../../src/printer/index.ts";

function print(text: string): string {
  const parsed = parseConfigAst(text);
  expect(parsed.ok && parsed.errors).toEqual([]);
  if (!parsed.ok) throw new Error("parse failed");
  return printConfig(parsed.ast, { layout: createLayout(text) }).text;
}

describe("config printer", () => {
  it("F-601 LA-45: keeps a closure parameter's type in config syntax, as `String token`", () => {
    const printed = print(
      "process {\n    ext.args = { 'a b'.split(' ').collect { String token -> token } }\n}\n",
    );
    expect(printed).toContain("{ String token -> token }");
    expect(printed).not.toContain("token: String");
    expect(parseConfigAst(printed)).toMatchObject({ ok: true, errors: [] });
  });

  it("F-601 LA-45: keeps the quotes of an option name that isn't an identifier", () => {
    const printed = print("process { ext.'a.b' = 1 }\n");
    expect(printed).toContain("ext.'a.b' = 1");
    expect(parseConfigAst(printed)).toMatchObject({ ok: true, errors: [] });
    expect(print("ext.'my-key' = 1\n")).toBe("ext.'my-key' = 1\n");
  });
});
