// The pre-scanner of the declaration-level fallback (ADR 0004, F-104). When a whole file does not parse, this splits the
// text into top-level chunks that the pack then parses one by one. It is hand-written, pure, iterative (no recursion, so
// deep nesting is safe) and never throws. It follows the lexical rules of ScriptLexer.g4 and ConfigLexer.g4 (whose
// string rules are identical): comments, the four string forms, GString interpolation, slashy strings and line escapes.
// A token-based scanner would not do: the lexer does not see an unclosed `/*` as a comment, but the fixture's author
// (and the user) mean everything after it to be inside it.
import type {
  Comment,
  CommentKind,
  DeclarationHead,
  Range,
} from "@nf-builder/lang-core";
import {
  isJavaIdentifierPart,
  isJavaIdentifierPartAndNotIdentifierIgnorable,
  isJavaIdentifierStartAndNotIdentifierIgnorable,
  isUpperCase,
} from "../parser/java-character.ts";

export type Grammar = "script" | "config";

export interface Chunk {
  /** UTF-16 offset: 0, or just after a "\n". Chunks tile the text. */
  readonly start: number;
  readonly end: number;
  /** 1-based line of `start` (lines end at "\n" only, as ANTLR counts them). */
  readonly line: number;
  /** The first code character (a `;` counts as code); `end` when the chunk has none. */
  readonly codeStart: number;
  readonly head: DeclarationHead | null;
  /** Comments between `start` and `codeStart` (all of them when the chunk has no code), shebang included. */
  readonly leadingComments: readonly Comment[];
}

export interface Prescan {
  readonly chunks: readonly Chunk[];
  /** What is still open at the end of the text, outermost first. */
  readonly open: readonly ("(" | "[" | "{" | "${" | "string" | "comment")[];
}

/** Words that start a script declaration (LA-02: each is a keyword of the 26.10 grammar). */
export const SCRIPT_STARTERS: readonly string[] = [
  "process",
  "workflow",
  "agent",
  "record",
  "enum",
  "output",
  "params",
  "include",
  "import",
  "nextflow",
  "def",
];

/**
 * The words the lexer gives a keyword token type (not `Identifier`, `NullLiteral` or `BooleanLiteral`), per grammar;
 * a slash after one of them starts a slashy string. Primitive type names are separate token types with the same effect.
 */
export const KEYWORDS: Readonly<Record<Grammar, readonly string[]>> = {
  script: [
    "as",
    "def",
    "in",
    "assert",
    "catch",
    "else",
    "enum",
    "if",
    "import",
    "instanceof",
    "new",
    "record",
    "return",
    "throw",
    "try",
    "nextflow",
    "params",
    "include",
    "from",
    "agent",
    "prompt",
    "process",
    "exec",
    "input",
    "output",
    "script",
    "shell",
    "stage",
    "stub",
    "topic",
    "tuple",
    "when",
    "workflow",
    "emit",
    "main",
    "onComplete",
    "onError",
    "publish",
    "take",
  ],
  config: [
    "as",
    "def",
    "in",
    "assert",
    "catch",
    "else",
    "if",
    "instanceof",
    "new",
    "return",
    "throw",
    "try",
    "includeConfig",
  ],
};
const PRIMITIVES = [
  "boolean",
  "char",
  "byte",
  "short",
  "int",
  "long",
  "float",
  "double",
];
const REGEX_WORDS: Record<Grammar, ReadonlySet<string>> = {
  script: new Set([...KEYWORDS.script, ...PRIMITIVES]),
  config: new Set([...KEYWORDS.config, ...PRIMITIVES]),
};
const STARTERS = new Set(SCRIPT_STARTERS);
/** Words after which a line continues on the next one. */
const CONTINUING_WORDS = new Set([
  "in",
  "as",
  "instanceof",
  "new",
  "return",
  "else",
  "throw",
  "assert",
  "try",
]);
/** Words that continue the statement before them when they start a line. */
const CONTINUATION_WORDS = new Set([
  "else",
  "catch",
  "finally",
  "in",
  "as",
  "instanceof",
]);

const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const BANG = 33;
const DQUOTE = 34;
const HASH = 35;
const DOLLAR = 36;
const SQUOTE = 39;
const LPAREN = 40;
const RPAREN = 41;
const STAR = 42;
const DOT = 46;
const SLASH = 47;
const SEMI = 59;
const EQUALS = 61;
const LBRACK = 91;
const BACKSLASH = 92;
const RBRACK = 93;
const UNDERSCORE = 95;
const LBRACE = 123;
const RBRACE = 125;

const isTerminator = (c: number) => c === LF || c === CR;
const isBlank = (c: number) => c === SPACE || c === TAB;
const isSpace = (c: number) => isBlank(c) || isTerminator(c);
const isDigit = (c: number) => c >= 48 && c <= 57;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const OPERATOR_CHARS = new Set(
  [..."+-*%&|^<>=!?:.~,"].map((c) => c.charCodeAt(0)),
);

/** Start of an identifier at `i`, as ScriptLexer's `Identifier` rules see it; the length in UTF-16 units, or 0. */
function identifierStartLength(text: string, i: number): number {
  const c = text.charCodeAt(i);
  if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) return 1;
  if (c === UNDERSCORE || c === DOLLAR) return 1;
  if (c < 0x80) return 0;
  const cp = text.codePointAt(i) ?? 0;
  return isJavaIdentifierStartAndNotIdentifierIgnorable(cp)
    ? cp > 0xffff
      ? 2
      : 1
    : 0;
}

function identifierPartLength(text: string, i: number): number {
  const c = text.charCodeAt(i);
  if (
    (c >= 97 && c <= 122) ||
    (c >= 65 && c <= 90) ||
    isDigit(c) ||
    c === UNDERSCORE ||
    c === DOLLAR
  )
    return 1;
  if (c < 0x80) return 0;
  const cp = text.codePointAt(i) ?? 0;
  return isJavaIdentifierPartAndNotIdentifierIgnorable(cp)
    ? cp > 0xffff
      ? 2
      : 1
    : 0;
}

/** End of the word starting at `i`; `i` when no word starts there. */
function wordEnd(text: string, i: number): number {
  let j = i;
  const first = identifierStartLength(text, j);
  if (first === 0) return i;
  j += first;
  for (;;) {
    const k = identifierPartLength(text, j);
    if (k === 0) return j;
    j += k;
  }
}

// The lexer

const Tok = {
  Word: 0,
  String: 1,
  Number: 2,
  Open: 3,
  Close: 4,
  Operator: 5,
  Semi: 6,
  Other: 7,
} as const;
type Tok = (typeof Tok)[keyof typeof Tok];

interface Handlers {
  /** A code token; for a GString only its opening quote (`strend` follows). Depths are the frame count before and after. */
  token(
    kind: Tok,
    start: number,
    end: number,
    depthBefore: number,
    depthAfter: number,
  ): void;
  /** The end of a double-quoted string that opened with `token`. */
  stringEnd(end: number): void;
  comment(
    kind: CommentKind,
    start: number,
    end: number,
    depth: number,
    unterminated: boolean,
    hasTerminator: boolean,
  ): void;
  /** Lexing starts over at `at`, the start of a line: an unclosed frame or string is given up (see `startsDeclaration`). */
  resync(at: number): void;
  /** A line terminator in code state; `end` is the offset just past it; `lf` is false for a lone "\r". */
  newline(end: number, lf: boolean): void;
}

const Frame = {
  Paren: 0,
  Bracket: 1,
  Brace: 2,
  Interpolation: 3,
  Dq: 4,
  Tdq: 5,
} as const;
type Frame = (typeof Frame)[keyof typeof Frame];
/** What `Prescan.open` calls each frame, indexed by `Frame`. */
const OPENED = ["(", "[", "{", "${", "string", "string"] as const;

/** `isFollowedByJavaLetterInGString` (semantic-predicates.ts) for the character after a `$`. */
function dollarStartsPath(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  if (Number.isNaN(c) || c === DOLLAR) return false;
  if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) return true;
  if (c === UNDERSCORE || c === LBRACE) return true;
  return c > 0x7f && isJavaIdentifierPart(text.codePointAt(i) ?? 0);
}

/** End of a slashy string opening at `i` (a "/"), or -1 when the lexer would see an operator. */
function slashyEnd(text: string, i: number): number {
  let j = i + 1;
  for (;;) {
    if (j >= text.length) return -1;
    const c = text.charCodeAt(j);
    if (c === SLASH) return j > i + 1 ? j + 1 : -1;
    if (c === 0) return -1;
    if (c === BACKSLASH && text.charCodeAt(j + 1) === SLASH) j += 2;
    else if (c === DOLLAR) {
      if (dollarStartsPath(text, j + 1)) return -1;
      j++;
    } else j++;
  }
}

/** Whether the quote at `i` is string content inside a triple-quoted string (the lexer's predicate on the next five characters). */
function tripleQuoteIsContent(text: string, i: number, quote: number): boolean {
  const q = (k: number) => text.charCodeAt(i + k) === quote;
  return !q(1) || !q(2) || (q(3) && (!q(4) || !q(5)));
}

interface QuotedEnd {
  /** Where the string ends, or where lexing starts over when `resynced`. */
  readonly end: number;
  readonly resynced?: boolean;
  /** Ran to the end of the text without a closing quote. */
  readonly open: boolean;
}

/** `'...'`, from the opening quote at `i`: ends at the closing quote or at a line terminator. */
function singleQuotedEnd(text: string, i: number): QuotedEnd {
  let j = i + 1;
  for (;;) {
    if (j >= text.length) return { end: text.length, open: true };
    const c = text.charCodeAt(j);
    if (c === SQUOTE) return { end: j + 1, open: false };
    if (isTerminator(c)) return { end: j, open: false };
    j += c === BACKSLASH && !isTerminator(text.charCodeAt(j + 1)) ? 2 : 1;
  }
}

/** `'''...'''`, from the first opening quote at `i`: ends at the closing quotes or at the end of the text. */
function tripleSingleQuotedEnd(
  text: string,
  i: number,
  resync: boolean,
): QuotedEnd {
  let j = i + 3;
  for (;;) {
    if (j >= text.length) return { end: text.length, open: true };
    const c = text.charCodeAt(j);
    if (c === LF && resync && startsDeclaration(text, j + 1))
      return { end: j + 1, open: false, resynced: true };
    if (c === SQUOTE && !tripleQuoteIsContent(text, j, SQUOTE))
      return { end: j + 3, open: false };
    j += c === BACKSLASH ? 2 : 1;
  }
}

/**
 * A line that starts in column 1 with a declaration keyword, blanks, and a name or `{`: where a script's chunk starts over
 * whatever is still open before it (an unclosed `{`, `"""` or `${` would otherwise swallow every later declaration).
 * Only for files the whole-file parse rejected; indented lines never count.
 */
const RESYNC_WORDS = [
  "process",
  "workflow",
  "include",
  "output",
  "enum",
  "record",
  "agent",
  "params",
];
function startsDeclaration(text: string, at: number): boolean {
  if (at > 0 && text.charCodeAt(at - 1) !== LF) return false;
  const end = wordEnd(text, at);
  if (end === at || !RESYNC_WORDS.includes(text.slice(at, end))) return false;
  const next = skipBlanks(text, end);
  return (
    next > end &&
    (text.charCodeAt(next) === LBRACE || identifierStartLength(text, next) > 0)
  );
}

function lex(
  text: string,
  grammar: Grammar,
  allowShebang: boolean,
  resync: boolean,
  h: Handlers,
): Prescan["open"] {
  const n = text.length;
  const regexWords = REGEX_WORDS[grammar];
  const stack: Frame[] = [];
  let unterminatedString = false;
  let unterminatedComment = false;
  /** After this token a slash is division (the lexer's REGEX_CHECK_ARRAY). */
  let lastIsValue = false;
  let i = 0;

  const startOver = (at: number): number => {
    stack.length = 0;
    unterminatedString = false;
    lastIsValue = false;
    h.resync(at);
    return at;
  };

  const findOpener = (closer: number): number => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const f = stack[k] as Frame;
      if (f === Frame.Paren || f === Frame.Bracket || f === Frame.Brace) {
        if (
          (closer === RPAREN && f === Frame.Paren) ||
          (closer === RBRACK && f === Frame.Bracket) ||
          (closer === RBRACE && f === Frame.Brace)
        )
          return k;
      } else return closer === RBRACE && f === Frame.Interpolation ? k : -1;
    }
    return -1;
  };

  const lineEnd = (from: number): number => {
    let j = from;
    while (j < n && !isTerminator(text.charCodeAt(j))) j++;
    return j;
  };

  if (allowShebang && text.startsWith("#!")) {
    let end = lineEnd(0);
    for (;;) {
      let next = end;
      if (text.charCodeAt(next) === CR && text.charCodeAt(next + 1) === LF)
        next += 2;
      else if (next < n) next += 1;
      if (next < n && text.startsWith("#!", next)) end = lineEnd(next);
      else break;
    }
    h.comment("shebang", 0, end, 0, false, false);
    i = end;
  }

  /** Scans string text from `from` (inside a double-quoted GString); returns where code resumes. */
  const scanGString = (from: number): number => {
    const triple = stack[stack.length - 1] === Frame.Tdq;
    let j = from;
    for (;;) {
      if (j >= n) {
        unterminatedString = true;
        return n;
      }
      const c = text.charCodeAt(j);
      if (c === DQUOTE) {
        if (!triple) {
          stack.pop();
          lastIsValue = true;
          h.stringEnd(j + 1);
          return j + 1;
        }
        if (!tripleQuoteIsContent(text, j, DQUOTE)) {
          stack.pop();
          lastIsValue = true;
          h.stringEnd(j + 3);
          return j + 3;
        }
        j++;
      } else if (
        triple &&
        c === LF &&
        resync &&
        startsDeclaration(text, j + 1)
      ) {
        return startOver(j + 1);
      } else if (!triple && isTerminator(c)) {
        stack.pop();
        lastIsValue = true;
        h.stringEnd(j);
        return j;
      } else if (c === BACKSLASH) {
        j += !triple && isTerminator(text.charCodeAt(j + 1)) ? 1 : 2;
      } else if (c === DOLLAR && text.charCodeAt(j + 1) === LBRACE) {
        stack.push(Frame.Interpolation);
        return j + 2;
      } else j++;
    }
  };

  while (i < n) {
    const top = stack[stack.length - 1];
    if (top === Frame.Dq || top === Frame.Tdq) {
      unterminatedString = false;
      i = scanGString(i);
      continue;
    }
    const c = text.charCodeAt(i);
    const depth = stack.length;
    if (isBlank(c)) {
      i++;
    } else if (c === LF) {
      i++;
      lastIsValue = false;
      h.newline(i, true);
      if (resync && stack.length > 0 && startsDeclaration(text, i))
        i = startOver(i);
    } else if (c === CR) {
      const crlf = text.charCodeAt(i + 1) === LF;
      i += crlf ? 2 : 1;
      lastIsValue = false;
      h.newline(i, crlf);
      if (crlf && resync && stack.length > 0 && startsDeclaration(text, i))
        i = startOver(i);
    } else if (c === BACKSLASH) {
      const next = text.charCodeAt(i + 1);
      if (next === CR && text.charCodeAt(i + 2) === LF) i += 3;
      else if (isTerminator(next)) i += 2;
      else {
        h.token(Tok.Other, i, i + 1, depth, depth);
        lastIsValue = false;
        i++;
      }
    } else if (c === SLASH) {
      const next = text.charCodeAt(i + 1);
      if (next === SLASH) {
        const end = lineEnd(i);
        h.comment("line", i, end, depth, false, false);
        lastIsValue = false;
        i = end;
      } else if (next === STAR) {
        const close = text.indexOf("*/", i + 2);
        const end = close < 0 ? n : close + 2;
        let hasTerminator = false;
        for (let k = i; k < end && !hasTerminator; k++)
          hasTerminator = isTerminator(text.charCodeAt(k));
        const kind = text.startsWith("/**", i) ? "doc" : "block";
        h.comment(kind, i, end, depth, close < 0, hasTerminator);
        if (close < 0) unterminatedComment = true;
        lastIsValue = false;
        i = end;
      } else {
        const end = lastIsValue ? -1 : slashyEnd(text, i);
        if (end >= 0) {
          h.token(Tok.String, i, end, depth, depth);
          lastIsValue = true;
          i = end;
        } else {
          h.token(Tok.Operator, i, i + 1, depth, depth);
          lastIsValue = false;
          i++;
        }
      }
    } else if (c === SQUOTE) {
      const triple =
        text.charCodeAt(i + 1) === SQUOTE && text.charCodeAt(i + 2) === SQUOTE;
      const q = triple
        ? tripleSingleQuotedEnd(text, i, resync)
        : singleQuotedEnd(text, i);
      h.token(Tok.String, i, q.end, depth, depth);
      if (q.open) unterminatedString = true;
      lastIsValue = true;
      i = q.resynced ? startOver(q.end) : q.end;
    } else if (c === DQUOTE) {
      const triple =
        text.charCodeAt(i + 1) === DQUOTE && text.charCodeAt(i + 2) === DQUOTE;
      stack.push(triple ? Frame.Tdq : Frame.Dq);
      const end = i + (triple ? 3 : 1);
      h.token(Tok.String, i, end, depth, depth + 1);
      i = end;
      unterminatedString = true;
    } else if (c === LPAREN || c === LBRACK || c === LBRACE) {
      stack.push(
        c === LPAREN ? Frame.Paren : c === LBRACK ? Frame.Bracket : Frame.Brace,
      );
      h.token(Tok.Open, i, i + 1, depth, depth + 1);
      lastIsValue = false;
      i++;
    } else if (c === RPAREN || c === RBRACK || c === RBRACE) {
      const k = findOpener(c);
      if (k >= 0) stack.length = k;
      h.token(Tok.Close, i, i + 1, depth, stack.length);
      lastIsValue = true;
      i++;
    } else if (isDigit(c)) {
      let j = i + 1;
      for (;;) {
        const d = text.charCodeAt(j);
        if (identifierPartLength(text, j) > 0)
          j += identifierPartLength(text, j);
        else if (d === DOT && isDigit(text.charCodeAt(j + 1))) j += 2;
        else break;
      }
      h.token(Tok.Number, i, j, depth, depth);
      lastIsValue = true;
      i = j;
    } else if (identifierStartLength(text, i) > 0) {
      const j = wordEnd(text, i);
      const word = text.slice(i, j);
      h.token(Tok.Word, i, j, depth, depth);
      lastIsValue = !regexWords.has(word);
      i = j;
    } else if (c === SEMI) {
      h.token(Tok.Semi, i, i + 1, depth, depth);
      lastIsValue = false;
      i++;
    } else if (OPERATOR_CHARS.has(c)) {
      let j = i + 1;
      while (j < n && OPERATOR_CHARS.has(text.charCodeAt(j))) j++;
      h.token(Tok.Operator, i, j, depth, depth);
      lastIsValue = false;
      i = j;
    } else {
      const length =
        isHighSurrogate(c) && isLowSurrogate(text.charCodeAt(i + 1)) ? 2 : 1;
      h.token(Tok.Other, i, i + length, depth, depth);
      lastIsValue = false;
      i += length;
    }
  }

  if (stack.some((f) => f === Frame.Dq || f === Frame.Tdq)) h.stringEnd(n);
  const open: Prescan["open"][number][] = stack.map((f) => OPENED[f]);
  if (
    unterminatedString &&
    stack.at(-1) !== Frame.Dq &&
    stack.at(-1) !== Frame.Tdq
  )
    open.push("string");
  if (unterminatedComment) open.push("comment");
  return open;
}

// Positions

/** Line and code-point column at increasing offsets, in one pass (lines end at "\n" only). */
export class Positioner {
  private offset = 0;
  private line = 1;
  private column = 1;
  constructor(private readonly text: string) {}

  at(offset: number): { line: number; column: number } {
    if (offset < this.offset) {
      this.offset = 0;
      this.line = 1;
      this.column = 1;
    }
    const text = this.text;
    for (let k = this.offset; k < offset; k++) {
      const c = text.charCodeAt(k);
      if (c === LF) {
        this.line++;
        this.column = 1;
      } else if (
        !(isLowSurrogate(c) && k > 0 && isHighSurrogate(text.charCodeAt(k - 1)))
      )
        this.column++;
    }
    this.offset = offset;
    return { line: this.line, column: this.column };
  }

  range(start: number, end: number): Range {
    const from = this.at(start);
    const to = this.at(end);
    return {
      start,
      end,
      line: from.line,
      column: from.column,
      endLine: to.line,
      endColumn: to.column,
    };
  }
}

interface CommentRecord {
  readonly kind: CommentKind;
  readonly start: number;
  readonly end: number;
  readonly ownLine: boolean;
}

function toComment(
  text: string,
  record: CommentRecord,
  positions: Positioner,
): Comment {
  return {
    kind: record.kind,
    text: text.slice(record.start, record.end),
    range: positions.range(record.start, record.end),
    ownLine: record.ownLine,
  };
}

// Continuation and starters

interface Previous {
  readonly kind: Tok;
  readonly start: number;
  readonly end: number;
  /** A "}" that closed the outermost frame; `;` after it keeps this. */
  readonly closedToZero: boolean;
}

/** The previous code line ends in something that needs more: an operator, a comma, a dot or a word like `new`. */
function continuesAfter(text: string, previous: Previous): boolean {
  if (previous.kind === Tok.Operator) {
    const op = text.slice(previous.start, previous.end);
    return !(op.endsWith("++") || op.endsWith("--") || op.endsWith(".*"));
  }
  if (previous.kind === Tok.Word)
    return CONTINUING_WORDS.has(text.slice(previous.start, previous.end));
  return false;
}

/** The line starting with this token continues the statement before it (ScriptParser.g4 allows `nls` there). */
function continuesBefore(text: string, kind: Tok, start: number): boolean {
  const c = text.charCodeAt(start);
  if (kind === Tok.Open) return c === LBRACE;
  if (kind === Tok.Word) {
    const word = text.slice(start, wordEnd(text, start));
    return CONTINUATION_WORDS.has(word);
  }
  if (kind !== Tok.Operator) return false;
  if (c === STAR) return text.charCodeAt(start + 1) !== SLASH;
  if (c === BANG) {
    if (text.charCodeAt(start + 1) === EQUALS) return true;
    for (const word of ["in", "instanceof"]) {
      if (
        text.startsWith(word, start + 1) &&
        identifierPartLength(text, start + 1 + word.length) === 0
      )
        return true;
    }
    return false;
  }
  return ".?:%&|^<>=,".includes(String.fromCharCode(c));
}

const skipBlanks = (text: string, i: number): number => {
  let j = i;
  while (isBlank(text.charCodeAt(j))) j++;
  return j;
};
const skipSpace = (text: string, i: number): number => {
  let j = i;
  while (isSpace(text.charCodeAt(j))) j++;
  return j;
};

/** `Type Name (` of a legacy function; the name, or null. `at` is the first character of the type. */
function legacyFunctionName(text: string, at: number): string | null {
  let j = wordEnd(text, at);
  if (j === at) return null;
  const first = text.slice(at, j);
  const cp = text.codePointAt(at) ?? 0;
  if (!PRIMITIVES.includes(first) && !isUpperCase(cp)) return null;
  for (;;) {
    if (text.charCodeAt(j) === DOT) {
      const e = wordEnd(text, j + 1);
      if (e === j + 1) return null;
      j = e;
    } else if (text.charCodeAt(j) === 60 /* < */) {
      let depth = 0;
      for (; ; j++) {
        const c = text.charCodeAt(j);
        if (
          Number.isNaN(c) ||
          isTerminator(c) ||
          "(){}=;'\"".includes(String.fromCharCode(c))
        )
          return null;
        if (c === 60) depth++;
        else if (c === 62 /* > */ && --depth === 0) {
          j++;
          break;
        }
      }
    } else if (text.charCodeAt(j) === LBRACK) {
      const k = skipBlanks(text, j + 1);
      if (text.charCodeAt(k) !== RBRACK) return null;
      j = k + 1;
    } else break;
  }
  const afterType = skipBlanks(text, j);
  const spaced =
    afterType > j ||
    text.charCodeAt(j - 1) === 62 ||
    text.charCodeAt(j - 1) === RBRACK;
  if (!spaced) return null;
  const e = wordEnd(text, afterType);
  if (e === afterType) return null;
  const k = skipBlanks(text, e);
  return text.charCodeAt(k) === LPAREN ? text.slice(afterType, e) : null;
}

function isStarter(text: string, start: number): boolean {
  const end = wordEnd(text, start);
  const word = text.slice(start, end);
  if (STARTERS.has(word)) {
    const c = text.charCodeAt(end);
    if (Number.isNaN(c) || isSpace(c) || c === LBRACE) return true;
    return c === DOT && (word === "params" || word === "nextflow");
  }
  return legacyFunctionName(text, start) !== null;
}

// The chunker

/**
 * Splits `text` into top-level chunks. A chunk starts at `lastCodeLineEnd`: just after the first "\n" that follows the
 * last code character, so blank and comment-only lines go with the next declaration and a same-line trailing comment
 * stays with the previous one. Boundaries (see the plan, 3.5): S1 after a line that ends in a `}` closing the outermost
 * frame; S2 before a line that starts with a declaration keyword; S3 before an own-line unterminated block comment;
 * C1 (configs) before a line that starts with a word or a quote. Never when the line continues the statement.
 */
export function prescan(
  text: string,
  grammar: Grammar,
  resync = false,
): Prescan {
  interface Pending {
    start: number;
    codeStart: number;
    leading: CommentRecord[];
  }
  const done: Pending[] = [];
  let current: Pending = { start: 0, codeStart: -1, leading: [] };
  /** Depth-0 comments since the last code token. */
  let trivia: CommentRecord[] = [];
  let lineHasCode = false;
  /** Just after the first "\n" in code state since the last code token; -1 when there is none. */
  let afterNewline = -1;
  let previous: Previous | null = null;

  const cut = (at: number) => {
    if (current.codeStart < 0)
      current.leading = trivia.filter(
        (r) => r.start >= current.start && r.start < at,
      );
    done.push(current);
    current = { start: at, codeStart: -1, leading: [] };
    trivia = trivia.filter((r) => r.start >= at);
  };

  const shouldCut = (kind: Tok, start: number, prev: Previous): boolean => {
    if (text.charCodeAt(start) === HASH) return false;
    if (continuesBefore(text, kind, start)) return false;
    if (grammar === "script") {
      if (prev.closedToZero) return true;
      return (
        kind === Tok.Word &&
        isStarter(text, start) &&
        !continuesAfter(text, prev)
      );
    }
    const quote = text.charCodeAt(start);
    return (
      (kind === Tok.Word ||
        (kind === Tok.String && (quote === SQUOTE || quote === DQUOTE))) &&
      !continuesAfter(text, prev)
    );
  };

  const open = lex(
    text,
    grammar,
    grammar === "script",
    resync && grammar === "script",
    {
      token(kind, start, end, depthBefore, depthAfter) {
        if (
          depthBefore === 0 &&
          !lineHasCode &&
          kind !== Tok.Close &&
          previous !== null &&
          afterNewline > current.start &&
          shouldCut(kind, start, previous)
        )
          cut(afterNewline);
        if (current.codeStart < 0) {
          current.codeStart = start;
          current.leading = trivia.filter((r) => r.start >= current.start);
        }
        trivia = [];
        lineHasCode = true;
        afterNewline = -1;
        previous =
          kind === Tok.Semi
            ? {
                kind,
                start,
                end,
                closedToZero: previous?.closedToZero ?? false,
              }
            : {
                kind,
                start,
                end,
                closedToZero:
                  kind === Tok.Close &&
                  text.charCodeAt(start) === RBRACE &&
                  depthBefore > 0 &&
                  depthAfter === 0,
              };
      },
      stringEnd() {},
      comment(kind, start, end, depth, unterminated, hasTerminator) {
        const ownLine = !lineHasCode;
        if (
          unterminated &&
          depth === 0 &&
          ownLine &&
          afterNewline > current.start &&
          afterNewline <= start
        )
          cut(afterNewline);
        // F-102's comments are the token text with trailing whitespace removed (comments.ts)
        if (depth === 0)
          trivia.push({
            kind,
            start,
            end: start + text.slice(start, end).trimEnd().length,
            ownLine,
          });
        if (hasTerminator) lineHasCode = false;
      },
      resync(at) {
        const b =
          afterNewline > current.start && afterNewline <= at
            ? afterNewline
            : at;
        if (b > current.start) cut(b);
        lineHasCode = false;
        afterNewline = -1;
        previous = null;
      },
      newline(end, lf) {
        lineHasCode = false;
        if (lf && afterNewline < 0) afterNewline = end;
      },
    },
  );

  done.push(current);
  const positions = new Positioner(text);
  const chunks: Chunk[] = done.map((pending, index) => {
    const end = done[index + 1]?.start ?? text.length;
    if (pending.codeStart < 0 && index === done.length - 1)
      pending.leading = trivia.filter((r) => r.start >= pending.start);
    const codeStart = pending.codeStart < 0 ? end : pending.codeStart;
    return {
      start: pending.start,
      end,
      line: positions.at(pending.start).line,
      codeStart,
      head: pending.codeStart < 0 ? null : scanHead(text, codeStart, grammar),
      leadingComments: pending.leading.map((r) =>
        toComment(text, r, positions),
      ),
    };
  });
  return { chunks, open };
}

// Heads

/** A dotted path `a.b.c` (blanks allowed around dots, removed from the result) starting at `at`; null when none. */
function dottedPath(
  text: string,
  at: number,
): { path: string; end: number } | null {
  let end = wordEnd(text, at);
  if (end === at) return null;
  let path = text.slice(at, end);
  for (;;) {
    const dot = skipBlanks(text, end);
    if (text.charCodeAt(dot) !== DOT) return { path, end };
    const next = skipBlanks(text, dot + 1);
    const e = wordEnd(text, next);
    if (e === next) return { path, end };
    path += `.${text.slice(next, e)}`;
    end = e;
  }
}

const isPlainAssign = (text: string, i: number): boolean =>
  text.charCodeAt(i) === EQUALS &&
  text.charCodeAt(i + 1) !== EQUALS &&
  text.charCodeAt(i + 1) !== 126; /* ~ */

function scriptHead(text: string, at: number): DeclarationHead | null {
  const end = wordEnd(text, at);
  if (end === at) return null;
  const word = text.slice(at, end);
  const next = skipSpace(text, end);
  const nameAfter = (): string | null => {
    const e = wordEnd(text, next);
    return e === next ? null : text.slice(next, e);
  };
  const atBlockOrEnd = next >= text.length || text.charCodeAt(next) === LBRACE;
  switch (word) {
    case "process":
    case "agent":
    case "record":
    case "enum":
      return { keyword: word, name: nameAfter() };
    case "workflow":
      return text.charCodeAt(end) === DOT
        ? null
        : { keyword: word, name: nameAfter() };
    case "output":
      return atBlockOrEnd ? { keyword: word, name: null } : null;
    case "include":
      return text.charCodeAt(end) === LBRACE ||
        end >= text.length ||
        isSpace(text.charCodeAt(end))
        ? { keyword: word, name: null }
        : null;
    case "params": {
      if (atBlockOrEnd) return { keyword: word, name: null };
      const path = dottedPath(text, at);
      if (path === null || !path.path.includes(".")) return null;
      return isPlainAssign(text, skipBlanks(text, path.end))
        ? { keyword: "param", name: path.path }
        : null;
    }
    case "import": {
      const path = dottedPath(text, next);
      return { keyword: word, name: path?.path ?? null };
    }
    case "nextflow": {
      const path = dottedPath(text, at);
      if (!path?.path.startsWith("nextflow.")) return null;
      return isPlainAssign(text, skipBlanks(text, path.end))
        ? { keyword: "featureFlag", name: path.path }
        : null;
    }
    case "def": {
      const name = nameAfter();
      if (name === null) return null;
      const e = next + name.length;
      return text.charCodeAt(skipBlanks(text, e)) === LPAREN
        ? { keyword: "function", name }
        : null;
    }
    default: {
      const name = legacyFunctionName(text, at);
      return name === null ? null : { keyword: "function", name };
    }
  }
}

/** One path segment of a config statement: a word, or a quoted name (returned without its quotes). */
function configSegment(
  text: string,
  at: number,
): { name: string; end: number } | null {
  const c = text.charCodeAt(at);
  if (c === SQUOTE || c === DQUOTE) {
    let j = at + 1;
    while (j < text.length && text.charCodeAt(j) !== c) {
      if (isTerminator(text.charCodeAt(j))) return null;
      j += text.charCodeAt(j) === BACKSLASH ? 2 : 1;
    }
    return j >= text.length
      ? null
      : { name: text.slice(at + 1, j), end: j + 1 };
  }
  const end = wordEnd(text, at);
  return end === at ? null : { name: text.slice(at, end), end };
}

function configHead(text: string, at: number): DeclarationHead | null {
  const wordStop = wordEnd(text, at);
  const word = text.slice(at, wordStop);
  if (word === "includeConfig") {
    const c = text.charCodeAt(wordStop);
    return Number.isNaN(c) ||
      isSpace(c) ||
      c === SQUOTE ||
      c === DQUOTE ||
      c === LPAREN
      ? { keyword: "includeConfig", name: null }
      : null;
  }
  if (word === "if" || word === "try" || word === "def")
    return { keyword: "invalid", name: null };
  let segment = configSegment(text, at);
  if (segment === null) return null;
  let path = segment.name;
  for (;;) {
    const dot = skipBlanks(text, segment.end);
    if (text.charCodeAt(dot) !== DOT) break;
    const next = configSegment(text, skipBlanks(text, dot + 1));
    if (next === null) return null;
    path += `.${next.name}`;
    segment = next;
  }
  const after = skipBlanks(text, segment.end);
  if (isPlainAssign(text, after)) return { keyword: "assign", name: path };
  if (text.charCodeAt(after) === LBRACE)
    return { keyword: "block", name: path };
  return null;
}

/** What the item starting at `at` (its first code character) is, by its first words; null when unrecognised. */
export function scanHead(
  text: string,
  at: number,
  grammar: Grammar,
): DeclarationHead | null {
  return grammar === "script" ? scriptHead(text, at) : configHead(text, at);
}

// Code spans

/**
 * The first and last code characters in `text[from, to)`: whatever is not whitespace, `;`, a stray closing bracket or a comment (a `#!` first
 * line counts as a comment only at offset 0). Null when there is none. Strings are lexed, so a comment marker inside one
 * is not a comment.
 */
export function codeSpan(
  text: string,
  from: number,
  to: number,
  grammar: Grammar,
): { start: number; end: number } | null {
  const slice = text.slice(from, to);
  let start = -1;
  let end = -1;
  lex(slice, grammar, from === 0 && grammar === "script", false, {
    token(kind, s, e, depthBefore) {
      // a closing bracket with nothing open is dropped by the lexer, so it is not code
      if (kind === Tok.Semi || (kind === Tok.Close && depthBefore === 0))
        return;
      if (start < 0) start = s;
      end = Math.max(end, e);
    },
    stringEnd(e) {
      end = Math.max(end, e);
    },
    comment() {},
    resync() {},
    newline() {},
  });
  return start < 0 ? null : { start: start + from, end: end + from };
}
