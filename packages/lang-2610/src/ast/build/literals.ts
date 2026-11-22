// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `string`, `stringLiteral`, `gstring`, `gstringText`, `gstringPath`, `integerLiteral` and `floatingPointLiteral`
// (Apache-2.0; see ../../../grammar/NOTICE), with the unescaping of apache/groovy GROOVY_4_0_33
// org.apache.groovy.parser.antlr4.util.StringUtils (`replaceEscapes`, `removeCR`, `trimQuotations`).
import type {
  Expression,
  GString,
  GStringText,
  Interpolation,
  NumberLiteral,
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
import { spanRanges } from "../positions.ts";
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

export function stringLiteral(
  ctx: StringLiteralContext,
  cx: BuildContext,
): StringLiteral {
  const text = ctx.getText();
  return {
    kind: "String",
    text,
    value: stringValue(text),
    quote: quoteOf(text),
    range: cx.range(ctx),
  };
}

export function numberLiteral(
  ctx: IntegerLiteralAltContext | FloatingPointLiteralAltContext,
  cx: BuildContext,
): NumberLiteral {
  return {
    kind: "Number",
    text: ctx.getText(),
    integer: has<IntegerLiteralAltContext>(ctx, "IntegerLiteral"),
    range: cx.range(ctx),
  };
}

const codePoints = (text: string) => {
  let n = 0;
  for (const _ of text) n++;
  return n;
};

function gstringText(
  ctx: ParserRuleContext,
  triple: boolean,
  cx: BuildContext,
): GStringText {
  const text = ctx.getText();
  return {
    kind: "GStringText",
    text,
    value: replaceEscapes(triple ? text.replaceAll("\r\n", "\n") : text, false),
    range: cx.range(ctx),
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
