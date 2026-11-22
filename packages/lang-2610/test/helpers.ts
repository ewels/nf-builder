import { CharStream } from "antlr4ng";
import type { ConfigLexer } from "../src/generated/ConfigLexer.ts";
import type { ScriptLexer } from "../src/generated/ScriptLexer.ts";
import { LexerSyntaxError } from "../src/parser/abstract-lexer.ts";

export type LexerClass = typeof ScriptLexer | typeof ConfigLexer;
export type Lexed = { type: string; text: string };

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
