// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// (`string`, `stringLiteral`, `gstring`, `gstringText`, `gstringPath`, `integerLiteral`, `floatingPointLiteral`) and
// nextflow/script/parser/EscapeUtils (the invalid-escape check in `checkEscapes`), all Apache-2.0; see
// ../../../grammar/NOTICE. The unescaping (`replaceEscapes`, `removeCR`, `trimQuotations`) follows apache/groovy
// GROOVY_4_0_33 org.apache.groovy.parser.antlr4.util.StringUtils, and the number-range messages follow its
// org.apache.groovy.parser.antlr4.util.Numbers (also Apache-2.0).
import type {
  Expression,
  GString,
  GStringText,
  Interpolation,
  NumberLiteral,
  ParseProblem,
  PropertyExpr,
  StringLiteral,
  Variable,
} from "@nf-builder/lang-core";
import type { ParserRuleContext } from "antlr4ng";
import type {
  FloatingPointLiteralAltContext,
  GstringContext,
  GstringDqExprAltContext,
  GstringTdqExprAltContext,
  IntegerLiteralAltContext,
  StringLiteralContext,
} from "../../generated/ScriptParser.ts";
import { codePoints, spanRanges } from "../positions.ts";
import { has, hasAny } from "./alt.ts";
import type { BuildContext } from "./context.ts";
import { expression } from "./expressions.ts";

const ESCAPES =
  /\\(?:u([0-9a-fA-F]{4})|([0-3]?[0-7]?[0-7])|([btnfrs"'\\$])|\r?\n)/g;
const SIMPLE: Record<string, string> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  s: " ",
};

/**
 * Replace the escapes of a string's content (its quotes already removed). A slashy string interprets none of them but
 * `\/`; elsewhere a backslash before any other character stays as written (nf-lang reports it, see `checkEscapes`).
 */
export function replaceEscapes(text: string, slashy: boolean): string {
  if (slashy) return text.replaceAll("\\/", "/");
  return text.replace(ESCAPES, (match, hex, octal, simple) => {
    if (hex !== undefined) return String.fromCharCode(Number.parseInt(hex, 16));
    if (octal !== undefined)
      return String.fromCharCode(Number.parseInt(octal, 8));
    if (simple !== undefined) return SIMPLE[simple] ?? simple;
    return match.slice(1).replace(/^\r?\n$/, ""); // a line continuation
  });
}

export type Quote = StringLiteral["quote"];

/** The delimiter a string literal starts with. */
export function quoteOf(text: string): Quote {
  if (text.startsWith("'''")) return "'''";
  if (text.startsWith('"""')) return '"""';
  if (text.startsWith("'")) return "'";
  if (text.startsWith('"')) return '"';
  return "/";
}

/** The value of a string literal, from its exact source text (quotes included). */
export function stringValue(text: string): string {
  const quote = quoteOf(text);
  const n = quote.length;
  const body = (
    quote.length === 3 || quote === "/" ? text.replaceAll("\r\n", "\n") : text
  ).slice(n, -n);
  return replaceEscapes(body, quote === "/");
}

const ESCAPABLE = "btnfrs\"'\\$\r\n";
const isHex = (c: string | undefined) =>
  c !== undefined && /^[0-9a-fA-F]$/.test(c);

/** Upstream's `isEscapable`: `i` is the index of the character after the backslash. */
function escapable(text: string, i: number): boolean {
  const c = text.charAt(i);
  if (c === "u") return [1, 2, 3, 4].every((k) => isHex(text[i + k]));
  return ESCAPABLE.includes(c) || (c >= "0" && c <= "7");
}

/**
 * One error per invalid escape in a string's source `text`, which starts at `line` and `column` (nf-lang's `EscapeUtils`).
 * The lexer accepts invalid escapes so that the error lands on the escape itself. Slashy strings have none. As nf-lang
 * does, columns after the start count UTF-16 units, not code points. The config builder uses this too.
 */
export function checkEscapes(
  text: string,
  line: number,
  column: number,
  slashy: boolean,
): ParseProblem[] {
  if (slashy || !text.includes("\\")) return [];
  const problems: ParseProblem[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "\n") {
      line++;
      column = 1;
    } else if (c === "\\" && i + 1 < text.length) {
      const next = text.charAt(i + 1);
      if (!escapable(text, i + 1))
        problems.push({
          source: "builder",
          message: `Invalid escape sequence: '\\${next}'`,
          line,
          column,
          endLine: line,
          endColumn: column + 2,
        });
      i++;
      if (next === "\n") {
        line++;
        column = 1;
      } else {
        column += 2;
      }
    } else {
      column++;
    }
  }
  return problems;
}

/**
 * The message of the exception Groovy's `Numbers.parseInteger` or `parseDecimal` throws for a number literal, or `null`.
 * Only decimal integers with an `i` or `l` suffix are range-checked (hex, octal and binary wrap), and `d` and `f`
 * literals must not overflow to infinity. The config builder uses this too.
 */
export function numberError(text: string, integer: boolean): string | null {
  const digits = text.replaceAll("_", "");
  const suffix = digits.at(-1)?.toLowerCase();
  if (integer) {
    if ((suffix !== "i" && suffix !== "l") || !/^[1-9]\d*[iIlL]$/.test(digits))
      return null;
    const value = BigInt(digits.slice(0, -1));
    const bits = value.toString(2).length;
    if (suffix === "i" && bits > 31)
      return `Number of value ${value} does not fit in the range of int, but int was enforced.`;
    if (suffix === "l" && bits > 63)
      return `Number of value ${value} does not fit in the range of long, but long was enforced.`;
    return null;
  }
  if (suffix !== "d" && suffix !== "f") return null;
  const value = Number(digits.slice(0, -1));
  const limit = suffix === "f" ? Math.fround(value) : value;
  return Number.isFinite(limit) ? null : "out of range";
}

/** `checkEscapesToo: false` for the names of config paths, blocks and selectors, which upstream does not check. */
export function stringLiteral(
  ctx: StringLiteralContext,
  cx: BuildContext,
  checkEscapesToo = true,
): StringLiteral {
  const text = ctx.getText();
  const at = cx.range(ctx);
  if (checkEscapesToo)
    cx.errors.push(
      ...checkEscapes(text, at.line, at.column, text.startsWith("/")),
    );
  return {
    kind: "String",
    text,
    value: stringValue(text),
    quote: quoteOf(text),
    range: at,
  };
}

export function numberLiteral(
  ctx: IntegerLiteralAltContext | FloatingPointLiteralAltContext,
  cx: BuildContext,
): NumberLiteral {
  const text = ctx.getText();
  const integer = has<IntegerLiteralAltContext>(ctx, "IntegerLiteral");
  const range = cx.range(ctx);
  const message = numberError(text, integer);
  // upstream keeps the last one and fails the build after the whole script is built
  if (message) cx.numberFormatError = { message, at: range };
  return { kind: "Number", text, integer, range };
}

function gstringText(
  ctx: ParserRuleContext,
  triple: boolean,
  cx: BuildContext,
): GStringText {
  const text = ctx.getText();
  const range = cx.range(ctx);
  cx.errors.push(...checkEscapes(text, range.line, range.column, false));
  return {
    kind: "GStringText",
    text,
    value: replaceEscapes(triple ? text.replaceAll("\r\n", "\n") : text, false),
    range,
  };
}

/** `$a.b.c`: a variable and its properties, each ranged inside the one token (`$` and the dots are not part of any). */
function gstringPath(ctx: ParserRuleContext, cx: BuildContext): Interpolation {
  const names = ctx.getText().split(".");
  let at = (ctx.start?.start ?? 0) + 1;
  const first = names[0]?.slice(1) ?? "";
  let object: Expression = {
    kind: "Variable",
    name: first,
    range: cx.index.range(at, at + codePoints(first)),
  } satisfies Variable;
  at += codePoints(first);
  for (const name of names.slice(1)) {
    at += 1;
    const property = {
      kind: "Identifier" as const,
      name,
      range: cx.index.range(at, at + codePoints(name)),
    };
    at += codePoints(name);
    object = {
      kind: "Property",
      object,
      navigation: ".",
      property,
      range: spanRanges(object.range, property.range),
    } satisfies PropertyExpr;
  }
  return {
    kind: "Interpolation",
    braced: false,
    expression: object,
    range: cx.range(ctx),
  };
}

export function gstring(ctx: GstringContext, cx: BuildContext): GString {
  const text = ctx.getText();
  const triple = text.startsWith('"""');
  const parts = [...ctx.gstringDqPart(), ...ctx.gstringTdqPart()];
  return {
    kind: "GString",
    quote: triple ? '"""' : '"',
    parts: parts.map((part): GStringText | Interpolation => {
      if (hasAny(part, "GStringText", "TdqGStringText"))
        return gstringText(part, triple, cx);
      if (hasAny(part, "GStringPath", "TdqGStringPath"))
        return gstringPath(part, cx);
      return {
        kind: "Interpolation",
        braced: true,
        expression: expression(
          (
            part as GstringDqExprAltContext | GstringTdqExprAltContext
          ).expression(),
          cx,
        ),
        range: cx.range(part),
      };
    }),
    range: cx.range(ctx),
  };
}
