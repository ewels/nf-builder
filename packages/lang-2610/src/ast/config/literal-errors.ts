// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/EscapeUtils.java
// `checkEscapes` and modules/nf-lang/src/main/java/nextflow/config/parser/ConfigAstBuilder.java `string`, `gstringText`
// and `integerLiteral` (Apache-2.0; see ../../../grammar/NOTICE), with the integer ranges of apache/groovy
// GROOVY_4_0_33 org.codehaus.groovy.runtime.Numbers `parseInteger`.
//
// Upstream finds these errors while it builds the expressions. The shared expression builder (F-102) does not check
// them yet, so the config builder checks the parse tree's literals here, in document order. TODO(F-102): once the shared
// builder reports escapes and number formats itself, delete this file, or the errors will be reported twice.
import type { ParseProblem } from "@nf-builder/lang-core";
import type { ParseTree } from "antlr4ng";
import {
  ConfigParser,
  GstringDqTextAltContext,
  GstringTdqTextAltContext,
  IntegerLiteralAltContext,
  StringLiteralContext,
} from "../../generated/ConfigParser.ts";
import type { BuildContext } from "../build/context.ts";

const configPrimaryRule = ConfigParser.RULE_configPrimary;
const ESCAPABLE = "btnfrs\"'\\$\r\n";
const isHex = (c: string | undefined) =>
  c !== undefined && /^[0-9a-fA-F]$/.test(c);

const escapable = (chars: readonly string[], i: number): boolean => {
  const c = chars[i] as string;
  if (c === "u") return [1, 2, 3, 4].every((k) => isHex(chars[i + k]));
  return ESCAPABLE.includes(c) || (c >= "0" && c <= "7");
};

/** One error per invalid escape in `text`, which starts at code point `start` of the input. Slashy strings have none. */
export function checkEscapes(
  text: string,
  start: number,
  slashy: boolean,
  cx: BuildContext,
): ParseProblem[] {
  if (slashy || !text.includes("\\")) return [];
  const chars = [...text];
  const problems: ParseProblem[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== "\\" || i + 1 >= chars.length) continue;
    if (!escapable(chars, i + 1)) {
      const at = cx.index.range(start + i, start + i + 2);
      problems.push({
        source: "builder",
        message: `Invalid escape sequence: '\\${chars[i + 1]}'`,
        line: at.line,
        column: at.column,
        endLine: at.endLine,
        endColumn: at.endColumn,
      });
    }
    i++;
  }
  return problems;
}

/** Groovy's `Numbers.parseInteger` range check: a decimal literal with an `i` or `l` suffix must fit that type. */
export function integerFormatError(text: string): string | null {
  const digits = text.replaceAll("_", "");
  const suffix = digits.at(-1)?.toLowerCase();
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

export type LiteralErrors = {
  /** In document order. */
  escapes: ParseProblem[];
  /** Upstream holds the last one and reports it after the last statement. */
  number: ParseProblem | null;
};

/** The invalid escapes and the integer literal out of range in a config parse tree. */
export function literalErrors(
  tree: ParseTree,
  cx: BuildContext,
): LiteralErrors {
  const out: LiteralErrors = { escapes: [], number: null };
  const visit = (node: ParseTree): void => {
    const ctx = node as {
      start?: { start: number } | null;
      parent?: unknown;
    };
    if (node instanceof StringLiteralContext) {
      // names in config paths and block headers are not checked
      if (
        (node.parent as { ruleIndex?: number } | null)?.ruleIndex !==
        configPrimaryRule
      ) {
        const text = node.getText();
        out.escapes.push(
          ...checkEscapes(
            text,
            ctx.start?.start ?? 0,
            text.startsWith("/"),
            cx,
          ),
        );
      }
    } else if (
      node instanceof GstringDqTextAltContext ||
      node instanceof GstringTdqTextAltContext
    ) {
      out.escapes.push(
        ...checkEscapes(node.getText(), ctx.start?.start ?? 0, false, cx),
      );
    } else if (node instanceof IntegerLiteralAltContext) {
      const message = integerFormatError(node.getText());
      if (message) {
        const at = cx.range(node);
        out.number = {
          source: "builder",
          message,
          line: at.line,
          column: at.column,
          endLine: at.endLine,
          endColumn: at.endColumn,
        };
      }
    }
    for (let i = 0; i < node.getChildCount(); i++) {
      const child = node.getChild(i);
      if (child) visit(child);
    }
  };
  visit(tree);
  return out;
}
