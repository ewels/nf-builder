// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// (Apache-2.0; see ../../../grammar/NOTICE). Upstream keeps each section as a `BlockStatement` or an array; ours are
// `Section` nodes so that the label and the section's own range survive (ADR 0027).
import type {
  Expression,
  ExpressionStatement,
  Range,
  Section,
  SectionLabel,
  Statement,
  Variable,
} from "@nf-builder/lang-core";
import type { ParserRuleContext, Token } from "antlr4ng";
import type { BlockStatementsContext } from "../../generated/ScriptParser.ts";
import { spanRanges, tokenRange } from "../positions.ts";
import type { BuildContext } from "./context.ts";
import { methodCall } from "./expressions.ts";

/** A section with a label: the range runs from the label to the end of `last`. */
export function labelled<T>(
  cx: BuildContext,
  label: Token,
  last: Range,
  items: T[],
): Section<T> {
  // the colon follows the label directly
  const colon = cx.tokens.get(label.tokenIndex + 1);
  const labelRange = tokenRange(label, colon, cx.index);
  return {
    kind: "Section",
    label: label.text as SectionLabel,
    labelRange,
    items,
    range: spanRanges(labelRange, last),
  };
}

/** A section without a label: directives, an implicit script body, an implicit workflow main. */
export function unlabelled<T>(range: Range, items: T[]): Section<T> {
  return { kind: "Section", label: null, labelRange: null, items, range };
}

/**
 * The range of `blockStatements` from its first to its last statement. `blockStatements` ends in `sep?`, which can be a
 * `;`, so the context's own range can run past the last statement.
 */
export function statementsRange(
  ctx: BlockStatementsContext,
  cx: BuildContext,
): Range {
  const all = ctx.statement();
  return spanRanges(
    cx.range(all[0] as ParserRuleContext),
    cx.range(all[all.length - 1] as ParserRuleContext),
  );
}

export function unparen(expression: Expression): Expression {
  let e = expression;
  while (e.kind === "Parenthesized") e = e.expression;
  return e;
}

/** An expression statement that is neither a name nor an assignment (`isEmitExpression`). */
export function isEmitExpression(statement: Statement): boolean {
  return (
    statement.kind === "ExpressionStatement" &&
    unparen(statement.expression).kind !== "Variable"
  );
}

export const variableStatement = (
  variable: Variable,
  range: Range,
): ExpressionStatement => ({
  kind: "ExpressionStatement",
  expression: variable,
  range,
});

/**
 * Upstream's `checkDirective`: a directive-like statement is a call of a bare name. A bare name `stdout` becomes
 * `stdout()`, and `cpus -1` becomes `cpus(-1)` with the unary minus ranging over `-1`. Anything else that is not such
 * a call is dropped (`null`).
 */
export function directive(
  statement: Statement,
  cx: BuildContext,
): ExpressionStatement | null {
  if (statement.kind !== "ExpressionStatement") return null;
  const e = unparen(statement.expression);

  if (e.kind === "Variable")
    return {
      ...statement,
      expression: methodCall(
        e,
        { args: [], trailingComma: false },
        false,
        [],
        statement.range,
      ),
    };

  if (
    e.kind === "Binary" &&
    e.operator === "-" &&
    unparen(e.left).kind === "Variable"
  ) {
    const minus = minusRange(e.left.range, cx);
    const value: Expression = {
      kind: "Unary",
      operator: "-",
      operand: e.right,
      range: spanRanges(minus, e.right.range),
    };
    return {
      ...statement,
      expression: methodCall(
        unparen(e.left),
        { args: [value], trailingComma: false },
        false,
        [],
        statement.range,
      ),
    };
  }

  if (e.kind !== "MethodCall" || e.receiver !== null || e.navigation !== null)
    return null;
  return statement;
}

/** The first `-` token after `left`: the operator of `cpus -1`. */
function minusRange(left: Range, cx: BuildContext): Range {
  for (const token of cx.tokens.getTokens())
    if (token.text === "-" && cx.index.offset(token.start) >= left.end)
      return cx.tokenRange(token);
  throw new Error("no minus token after a directive name");
}
