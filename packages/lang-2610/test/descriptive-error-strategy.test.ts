import {
  CharStream,
  CommonTokenStream,
  ParseCancellationException,
  PredictionMode,
  type Token,
} from "antlr4ng";
import { describe, expect, it } from "vitest";
import { ScriptLexer } from "../src/generated/ScriptLexer.ts";
import { ScriptParser } from "../src/generated/ScriptParser.ts";
import {
  DescriptiveErrorStrategy,
  EOF_ERROR_MESSAGE,
} from "../src/parser/descriptive-error-strategy.ts";
import { parseConfig, parseScript } from "../src/parser/parse.ts";

const errorOf = (
  outcome: ReturnType<typeof parseScript | typeof parseConfig>,
) => {
  if (outcome.ok) throw new Error("expected a syntax error");
  return outcome.error;
};

// Upstream: nf-lang DescriptiveErrorStrategy.java and ScriptAstBuilder.java#L2239-L2249 (v26.10.7).
describe("DescriptiveErrorStrategy", () => {
  it("F-101 LA-30 ADR-0005: a parser error names the offending token as nf-lang's DescriptiveErrorStrategy does", () => {
    expect(errorOf(parseScript("workflow {\n    foo(1, 2 3, 4)\n}\n"))).toEqual(
      {
        source: "parser",
        message: "Unexpected input: '3'",
        line: 2,
        column: 14,
        endLine: 2,
        endColumn: 15,
      },
    );
    expect(
      errorOf(parseConfig("process {\n    cpus = 4\n    memory 8.GB\n}\n")),
    ).toMatchObject({
      message: "Unexpected input: '8'",
      line: 3,
      column: 12,
      endLine: 3,
      endColumn: 13,
    });
  });

  it("F-101 LA-30 ADR-0005: whitespace in the offending token is escaped", () => {
    const text =
      "process hello {\n    debug true:\n\n    script:\n    echo\n}\n";
    expect(errorOf(parseScript(text))).toMatchObject({
      message: "Unexpected input: '\\n'",
      line: 2,
      column: 16,
      endLine: 2,
      endColumn: 17,
    });
  });

  it("F-101 LA-30 ADR-0005: an error at end of input says to check for an unclosed brace, bracket, parenthesis or string", () => {
    expect(errorOf(parseScript("workflow {\n"))).toMatchObject({
      message: EOF_ERROR_MESSAGE,
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 2,
    });
    expect(errorOf(parseConfig("process {\n"))).toMatchObject({
      message: EOF_ERROR_MESSAGE,
      line: 2,
      column: 1,
      endColumn: 2,
    });
  });

  it("F-101 LA-30 ADR-0005: in SLL mode the strategy bails out without reporting, in LL mode it reports once", () => {
    const tokens = new CommonTokenStream(
      new ScriptLexer(
        CharStream.fromString("workflow {\n    foo(1, 2 3, 4)\n}\n"),
      ),
    );
    const parser = new ScriptParser(tokens);
    parser.removeErrorListeners();
    const heard: string[] = [];
    parser.addErrorListener({
      syntaxError: (_r, _s: Token | null, _l, _c, message) => {
        heard.push(message);
      },
      reportAmbiguity: () => {},
      reportAttemptingFullContext: () => {},
      reportContextSensitivity: () => {},
    });
    parser.errorHandler = new DescriptiveErrorStrategy();
    parser.interpreter.predictionMode = PredictionMode.SLL;
    expect(() => parser.compilationUnit()).toThrow(ParseCancellationException);
    expect(heard).toEqual([]);
    tokens.seek(0);
    parser.reset();
    parser.interpreter.predictionMode = PredictionMode.LL;
    expect(() => parser.compilationUnit()).toThrow(ParseCancellationException);
    expect(heard).toEqual(["Unexpected input: '3'"]);
  });

  it("F-101 LA-30: the error range spans the offending token; lexer errors span one column", () => {
    const tuple = (line: string) =>
      `process hello {\n    output:\n    ${line}\n\n    script:\n    ""\n}\n`;
    expect(
      errorOf(parseScript(tuple('tuple val("hello") val("goodbye")'))),
    ).toMatchObject({
      message: "Unexpected input: 'val'",
      line: 3,
      column: 24,
      endLine: 3,
      endColumn: 27,
    });
    expect(
      errorOf(parseScript(tuple('tuple val("hello"), val("goodbye") emit: x'))),
    ).toMatchObject({ line: 3, column: 40, endLine: 3, endColumn: 44 });
    expect(errorOf(parseScript("x = 09\n"))).toMatchObject({
      source: "lexer",
      line: 1,
      column: 5,
      endLine: 1,
      endColumn: 6,
    });
    expect(
      errorOf(parseScript('workflow {\n    v = "𝐀𝐀" + = 1\n}\n')),
    ).toMatchObject({ line: 2, column: 16, endLine: 2, endColumn: 17 });
  });
});
