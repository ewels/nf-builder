// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/Comments.java
// `collect`, `blankLinesBefore` and `startsLine` (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE).
import type { SourceLayout } from "@nf-builder/lang-core";
import { CharStream, CommonTokenStream, Token } from "antlr4ng";
import { ScriptLexer } from "../generated/ScriptLexer.ts";

/** The layout of a tree no text backs: no blank lines, and no node starts a line. */
export const FRESH_LAYOUT: SourceLayout = {
  blankLinesBefore: () => 0,
  startsLine: () => false,
};

const countNewLines = (text: string) => {
  let n = 0;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) n++;
  return n;
};

/**
 * Lex `text` as a script and record which lines hold a token (a multi-line token marks every line it spans) and the
 * column of the first token on each line. Positions are as `Range` has them: lines advance on "\n", columns count code
 * points. Throws the lexer's error when `text` does not lex.
 */
export function createLayout(text: string): SourceLayout {
  const lexer = new ScriptLexer(CharStream.fromString(text));
  lexer.removeErrorListeners();
  const stream = new CommonTokenStream(lexer);
  stream.fill();

  const contentLines = new Set<number>();
  const firstColumns = new Map<number, number>();
  for (const token of stream.getTokens()) {
    if (token.type === Token.EOF) continue;
    const raw = token.text;
    if (!raw || raw.startsWith("\n") || raw.startsWith("\r")) continue;
    const content = raw.replace(/\r\n?/g, "\n").trimEnd();
    const first = token.line;
    const last = first + countNewLines(content);
    for (let l = first; l <= last; l++) contentLines.add(l);
    // the tokens are in source order, so the first token seen on a line is the leftmost one
    if (!firstColumns.has(first)) firstColumns.set(first, token.column + 1);
  }

  return {
    blankLinesBefore(line) {
      let result = 0;
      for (let i = line - 1; i >= 1 && !contentLines.has(i); i--) result++;
      return result;
    },
    startsLine(line, column) {
      return firstColumns.get(line) === column;
    },
  };
}
