import {
  BailErrorStrategy,
  CharStream,
  CommonTokenStream,
  PredictionMode,
  Trees,
} from "antlr4ng";
import { ConfigLexer } from "../src/generated/ConfigLexer.ts";
import { ConfigParser } from "../src/generated/ConfigParser.ts";
import { ScriptLexer } from "../src/generated/ScriptLexer.ts";
import { ScriptParser } from "../src/generated/ScriptParser.ts";
import { LexerSyntaxError } from "../src/parser/abstract-lexer.ts";

type LexerClass = typeof ScriptLexer | typeof ConfigLexer;
type Lexed = { type: string; text: string };

/** Lex `text` to the end and return each token's symbolic type name and text (EOF excluded). */
export function lex(Lexer: LexerClass, text: string): Lexed[] {
  const lexer = new Lexer(CharStream.fromString(text));
  lexer.removeErrorListeners();
  return lexer.getAllTokens().map((token) => ({
    type: lexer.vocabulary.getSymbolicName(token.type) ?? String(token.type),
    text: token.text ?? "",
  }));
}

export const types = (tokens: Lexed[]): string[] => tokens.map((t) => t.type);

/** The lexer error `text` provokes. Throws if it lexes cleanly. */
export function lexError(Lexer: LexerClass, text: string): LexerSyntaxError {
  try {
    lex(Lexer, text);
  } catch (error) {
    if (error instanceof LexerSyntaxError) return error;
    throw error;
  }
  throw new Error(`expected a lexer error for ${JSON.stringify(text)}`);
}

/** The tree (as a string) of a pure LL parse with no stage 1, or undefined if it fails. */
export function pureLlTree(
  kind: "script" | "config",
  text: string,
): string | undefined {
  const input = CharStream.fromString(text);
  const [lexer, parser] =
    kind === "script"
      ? (() => {
          const l = new ScriptLexer(input);
          return [l, new ScriptParser(new CommonTokenStream(l))] as const;
        })()
      : (() => {
          const l = new ConfigLexer(input);
          return [l, new ConfigParser(new CommonTokenStream(l))] as const;
        })();
  lexer.removeErrorListeners();
  parser.removeErrorListeners();
  parser.errorHandler = new BailErrorStrategy();
  parser.interpreter.predictionMode = PredictionMode.LL;
  try {
    return Trees.toStringTree(parser.compilationUnit(), parser.ruleNames);
  } catch {
    // A parser or lexer error: the parser under test fails on this text too.
    return undefined;
  }
}
