import { describe, expect, it } from "vitest";
import { ConfigLexer } from "../src/generated/ConfigLexer.ts";
import { ScriptLexer } from "../src/generated/ScriptLexer.ts";
import { lex, lexError, types } from "./helpers.ts";

describe("ScriptLexer ported actions", () => {
  it("ADR-0005: a slash after an identifier or closing bracket is division, elsewhere it starts a slashy string", () => {
    expect(types(lex(ScriptLexer, "a / b"))).toEqual([
      "Identifier",
      "DIV",
      "Identifier",
    ]);
    expect(types(lex(ScriptLexer, "(a) / b"))).toEqual([
      "LPAREN",
      "Identifier",
      "RPAREN",
      "DIV",
      "Identifier",
    ]);
    const slashy = lex(ScriptLexer, "x = /ab+c/");
    expect(types(slashy)).toEqual(["Identifier", "ASSIGN", "StringLiteral"]);
    expect(slashy[2]?.text).toBe("/ab+c/");
  });

  it('ADR-0005: "/*" never starts a slashy string', () => {
    const tokens = lex(ScriptLexer, "x = /* c */ 1");
    expect(types(tokens)).toEqual([
      "Identifier",
      "ASSIGN",
      "NL",
      "IntegerLiteral",
    ]);
    expect(tokens[2]?.text).toBe("/* c */");
  });

  it('ADR-0005: in a GString, "$" starts a path only before a Java letter or "{"', () => {
    expect(lex(ScriptLexer, '"a $b"')).toEqual([
      { type: "GStringBegin", text: '"' },
      { type: "GStringText", text: "a " },
      { type: "GStringPath", text: "$b" },
      { type: "GStringEnd", text: '"' },
    ]);
    expect(types(lex(ScriptLexer, '"a $\u007Bb}"'))).toEqual([
      "GStringBegin",
      "GStringText",
      "GStringExprStart",
      "Identifier",
      "RBRACE",
      "GStringEnd",
    ]);
    expect(lexError(ScriptLexer, '"cost $ 5"').message).toContain(
      "Unexpected character: '$'",
    );
    // In a slashy string a lone "$" is an ordinary character.
    expect(types(lex(ScriptLexer, "x = /cost $ 5/"))).toEqual([
      "Identifier",
      "ASSIGN",
      "StringLiteral",
    ]);
  });

  it("ADR-0005: triple-quoted and empty strings follow the upstream quotation predicates", () => {
    for (const text of [
      '""',
      '"""x"""',
      '"""a"b"""',
      "''",
      "'''x'''",
      "'''a'b'''",
    ]) {
      expect(lex(ScriptLexer, text), text).toEqual([
        { type: "StringLiteral", text },
      ]);
    }
  });

  it('ADR-0005: "!in" and "!instanceof" are operators only before whitespace or a bracket', () => {
    expect(types(lex(ScriptLexer, "a !in b"))).toEqual([
      "Identifier",
      "NOT_IN",
      "Identifier",
    ]);
    expect(types(lex(ScriptLexer, "a !in[1]"))).toContain("NOT_IN");
    expect(types(lex(ScriptLexer, "a !instanceof b"))).toEqual([
      "Identifier",
      "NOT_INSTANCEOF",
      "Identifier",
    ]);
    const inside = lex(ScriptLexer, "!inside");
    expect(types(inside)).toEqual(["NOT", "Identifier"]);
    expect(inside[1]?.text).toBe("inside");
  });

  it("ADR-0005: capitalised and Unicode identifiers lex per Java identifier rules", () => {
    expect(lex(ScriptLexer, "Foo")).toEqual([
      { type: "CapitalizedIdentifier", text: "Foo" },
    ]);
    expect(lex(ScriptLexer, "Éa")[0]?.type).toBe("CapitalizedIdentifier");
    for (const text of ["foo", "café", "$x", "_y", "日本語", "a\u{1D400}b"]) {
      expect(lex(ScriptLexer, text), text).toEqual([
        { type: "Identifier", text },
      ]);
    }
  });

  // Each message and position below was also produced by `nextflow lint` 26.10.7 on a file with the same content.
  it("ADR-0005: lexer errors from require() carry upstream messages and positions", () => {
    const underscore = lexError(ScriptLexer, "x = 1_\n");
    expect(underscore.message).toBe(
      "Number ending with underscores is invalid @ line 1, column 6",
    );
    expect([underscore.line, underscore.column]).toEqual([1, 6]);

    const octal = lexError(ScriptLexer, "x = 09\n");
    expect(octal.message).toBe("Invalid octal number @ line 1, column 5");
    expect([octal.line, octal.column]).toEqual([1, 5]);

    const shebang = lexError(ScriptLexer, "x\n#!/bin/sh\n");
    expect(shebang.message).toBe(
      "Shebang comment should appear at the first line @ line 2, column 8",
    );
    expect([shebang.line, shebang.column]).toEqual([2, 8]);

    const stray = lexError(ScriptLexer, "x = @\n");
    expect(stray.message).toBe("Unexpected character: '@'");
    expect([stray.line, stray.column]).toEqual([1, 5]);
    expect(lexError(ScriptLexer, "x = \u0001").message).toBe(
      "Unexpected character: '\u0001'",
    );

    const second = lexError(ScriptLexer, "x = 1\nx = 09\n");
    expect([second.line, second.column]).toEqual([2, 5]);
  });

  it("ADR-0005: a shebang on the first line is a comment", () => {
    expect(types(lex(ScriptLexer, "#!/usr/bin/env nextflow\nx"))).toEqual([
      "NL",
      "NL",
      "Identifier",
    ]);
  });

  it("ADR-0005: comments are NL tokens that keep their text", () => {
    expect(lex(ScriptLexer, "// x")).toEqual([{ type: "NL", text: "// x" }]);
    expect(lex(ScriptLexer, "/* y */")).toEqual([
      { type: "NL", text: "/* y */" },
    ]);
  });
});

describe("ConfigLexer ported actions", () => {
  it("ADR-0005: the config lexer applies the same ported actions", () => {
    expect(types(lex(ConfigLexer, "a / b"))).toEqual([
      "Identifier",
      "DIV",
      "Identifier",
    ]);
    expect(types(lex(ConfigLexer, "x = /ab+c/"))).toEqual([
      "Identifier",
      "ASSIGN",
      "StringLiteral",
    ]);
    expect(types(lex(ConfigLexer, "x = /* c */ 1"))).toEqual([
      "Identifier",
      "ASSIGN",
      "NL",
      "IntegerLiteral",
    ]);
    expect(types(lex(ConfigLexer, '"a $b"'))).toEqual([
      "GStringBegin",
      "GStringText",
      "GStringPath",
      "GStringEnd",
    ]);
    expect(lex(ConfigLexer, "'''x'''")).toEqual([
      { type: "StringLiteral", text: "'''x'''" },
    ]);
    expect(types(lex(ConfigLexer, "a !in b"))).toEqual([
      "Identifier",
      "NOT_IN",
      "Identifier",
    ]);
    expect(lex(ConfigLexer, "Foo café")).toEqual([
      { type: "CapitalizedIdentifier", text: "Foo" },
      { type: "Identifier", text: "café" },
    ]);
    expect(lexError(ConfigLexer, "x = 1_\n").message).toBe(
      "Number ending with underscores is invalid @ line 1, column 6",
    );
    expect(lexError(ConfigLexer, "x = 09\n").message).toBe(
      "Invalid octal number @ line 1, column 5",
    );
    expect(lexError(ConfigLexer, "x = @").message).toBe(
      "Unexpected character: '@'",
    );
  });
});
