// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/PositionConfigureUtils.java
// (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE), changed to give half-open UTF-16 offsets as well as
// code-point lines and columns, and to trim `NL` tokens from the ends of a context (ADR 0027).

import type { Position, Range } from "@nf-builder/lang-core";
import type {
  Lexer,
  ParserRuleContext,
  Token,
  TokenSource,
  TokenStream,
} from "antlr4ng";

/**
 * antlr4ng reads the input as code points, so `Token.start`, `Token.stop` and `Token.column` count code points, and lines
 * advance on "\n" only (CRLF is one NL token). Nodes carry UTF-16 offsets, so slicing the text works.
 */
export class PositionIndex {
  private readonly textLength: number;
  /** The number of code points. */
  readonly size: number;
  /** Code-point index to UTF-16 offset; `null` when the text has no surrogates (the identity). */
  private readonly offsets: readonly number[] | null;
  /** Code-point index of the first character of each line. */
  private readonly lineStarts: number[] = [0];

  constructor(text: string) {
    this.textLength = text.length;
    if (/[\uD800-\uDFFF]/.test(text)) {
      const offsets: number[] = [];
      let offset = 0;
      for (const ch of text) {
        offsets.push(offset);
        offset += ch.length;
        if (ch === "\n") this.lineStarts.push(offsets.length);
      }
      offsets.push(offset);
      this.offsets = offsets;
      this.size = offsets.length - 1;
    } else {
      this.offsets = null;
      this.size = text.length;
      for (let i = 0; i < text.length; i++)
        if (text[i] === "\n") this.lineStarts.push(i + 1);
    }
  }

  offset(codePoint: number): number {
    return this.offsets
      ? (this.offsets[codePoint] ?? this.textLength)
      : Math.min(codePoint, this.textLength);
  }

  position(codePoint: number): Position {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] as number) <= codePoint) lo = mid;
      else hi = mid - 1;
    }
    return {
      line: lo + 1,
      column: codePoint - (this.lineStarts[lo] as number) + 1,
    };
  }

  /** Half-open, both ends in code points. */
  range(startCodePoint: number, endCodePoint: number): Range {
    const from = this.position(startCodePoint);
    const to = this.position(endCodePoint);
    return {
      start: this.offset(startCodePoint),
      end: this.offset(endCodePoint),
      line: from.line,
      column: from.column,
      endLine: to.line,
      endColumn: to.column,
    };
  }
}

export function tokenRange(
  first: Token,
  last: Token,
  index: PositionIndex,
): Range {
  return index.range(first.start, last.stop + 1);
}

const nlTypes = new WeakMap<object, number>();

/** The token type of `NL` in the lexer behind `source` (it differs between the script and config lexers). */
export function nlTokenType(source: TokenSource): number {
  let type = nlTypes.get(source);
  if (type === undefined) {
    const vocabulary = (source as Lexer).vocabulary;
    type = vocabulary.maxTokenType;
    while (type > 0 && vocabulary.getSymbolicName(type) !== "NL") type--;
    nlTypes.set(source, type);
  }
  return type;
}

/**
 * The range of a context from its first to its last token that is not an `NL`. Upstream spans `ctx.start` to `ctx.stop`,
 * so rules ending in `sep?` or `nls` run into the next line; ours stop at the last real token. An empty context gives a
 * zero-width range at its start.
 */
export function contextRange(
  ctx: ParserRuleContext,
  tokens: TokenStream,
  index: PositionIndex,
): Range {
  const first = ctx.start;
  const stop = ctx.stop;
  if (!first || !stop || stop.tokenIndex < first.tokenIndex)
    return index.range(first?.start ?? 0, first?.start ?? 0);
  const nl = nlTokenType(tokens.tokenSource);
  let from = first.tokenIndex;
  let to = stop.tokenIndex;
  while (from <= to && tokens.get(from).type === nl) from++;
  while (to >= from && tokens.get(to).type === nl) to--;
  if (to < from) return index.range(first.start, first.start);
  return tokenRange(tokens.get(from), tokens.get(to), index);
}

/** From the start of `first` to the end of `last`. */
export function spanRanges(first: Range, last: Range): Range {
  return {
    start: first.start,
    end: last.end,
    line: first.line,
    column: first.column,
    endLine: last.endLine,
    endColumn: last.endColumn,
  };
}
