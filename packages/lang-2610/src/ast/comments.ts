// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/Comments.java
// (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE). The text is kept exact, not normalised.
import type { Comment, CommentKind } from "@nf-builder/lang-core";
import { type Token, Token as TokenClass } from "antlr4ng";
import { nlTokenType, type PositionIndex } from "./positions.ts";

const isComment = (text: string) =>
  text.startsWith("//") || text.startsWith("/*") || text.startsWith("#!");

const codePoints = (text: string) => {
  let n = 0;
  for (const _ of text) n++;
  return n;
};

/**
 * Collect the comments from a filled token buffer. Comments are `NL` tokens whose text starts with `//`, `/*` or `#!`;
 * a `#!` token at the very start is the shebang, kept apart from the rest.
 */
export function collectComments(
  tokens: readonly Token[],
  index: PositionIndex,
): { shebang: Comment | null; comments: Comment[] } {
  const comments: Comment[] = [];
  let shebang: Comment | null = null;
  let first = true;
  let lastCodeLine = -1;

  for (const token of tokens) {
    if (token.type === TokenClass.EOF) continue;
    const raw = token.text;
    if (!raw || raw.startsWith("\n") || raw.startsWith("\r")) continue;
    const text = raw.trimEnd();
    const range = index.range(token.start, token.start + codePoints(text));

    if (
      isComment(text) &&
      token.tokenSource &&
      token.type === nlTokenType(token.tokenSource)
    ) {
      const kind: CommentKind = text.startsWith("#!")
        ? "shebang"
        : text.startsWith("/**")
          ? "doc"
          : text.startsWith("/*")
            ? "block"
            : "line";
      const comment: Comment = {
        kind,
        text,
        range,
        ownLine: lastCodeLine !== range.line,
      };
      if (first && kind === "shebang") shebang = comment;
      else comments.push(comment);
    } else {
      lastCodeLine = range.endLine;
    }
    first = false;
  }
  return { shebang, comments };
}
