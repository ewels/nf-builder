// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `statement` and its helpers (Apache-2.0; see ../../../grammar/NOTICE).
//
// Shared with the config grammar's closures: the statement rules and their alternatives are the same in both grammars.
// `variableDeclaration` and `catchClause` differ in shape, and both shapes are handled (see expressions.ts and alt.ts).
import type {
  Assignment,
  AssignmentOperator,
  CatchClause,
  Expression,
  Identifier,
  Statement,
  TupleTarget,
  TypedName,
  Variable,
  VariableDeclaration,
} from "@nf-builder/lang-core";
import type { ParserRuleContext } from "antlr4ng";
import type {
  AssertStmtAltContext,
  AssignmentStmtAltContext,
  BlockStatementsContext,
  CatchClauseContext,
  ExpressionStmtAltContext,
  IdentifierContext,
  IfElseStmtAltContext,
  MultipleAssignmentStmtAltContext,
  ReturnStmtAltContext,
  StatementContext,
  StatementOrBlockContext,
  StatementOrLabeledContext,
  ThrowStmtAltContext,
  TryCatchStmtAltContext,
  VariableDeclarationContext,
  VariableDeclarationStmtAltContext,
  VariableNamesContext,
} from "../../generated/ScriptParser.ts";
import { spanRanges } from "../positions.ts";
import { has } from "./alt.ts";
import type { BuildContext } from "./context.ts";
import { argumentList, expression, methodCall } from "./expressions.ts";
import {
  checkVariableName,
  identifier,
  legacyType,
  qualifiedType,
  typedName,
} from "./types.ts";

export function statement(ctx: StatementContext, cx: BuildContext): Statement {
  const range = cx.range(ctx);

  if (has<IfElseStmtAltContext>(ctx, "ifElseStatement")) {
    const s = ctx.ifElseStatement();
    const otherwise = s.ELSE();
    return {
      kind: "If",
      condition: expression(s.parExpression().expression(), cx),
      consequent: statementOrBlock(s._tb as StatementOrBlockContext, cx),
      alternate: otherwise
        ? statementOrBlock(s._fb as StatementOrBlockContext, cx)
        : null,
      elseRange: otherwise ? cx.tokenRange(otherwise.symbol) : null,
      range,
    };
  }

  if (has<TryCatchStmtAltContext>(ctx, "tryCatchStatement")) {
    const s = ctx.tryCatchStatement();
    return {
      kind: "TryCatch",
      body: statementOrBlock(s.statementOrBlock(), cx),
      catches: s.catchClause().map((c) => catchClause(c, cx)),
      range,
    };
  }

  if (has<ReturnStmtAltContext>(ctx, "RETURN")) {
    const value = ctx.expression();
    return {
      kind: "Return",
      value: value ? expression(value, cx) : null,
      range,
    };
  }

  if (has<ThrowStmtAltContext>(ctx, "THROW"))
    return { kind: "Throw", value: expression(ctx.expression(), cx), range };

  if (has<AssertStmtAltContext>(ctx, "assertStatement")) {
    const s = ctx.assertStatement();
    return {
      kind: "Assert",
      condition: expression(s._condition as never, cx),
      message: s._message ? expression(s._message, cx) : null,
      range,
    };
  }

  if (has<VariableDeclarationStmtAltContext>(ctx, "variableDeclaration"))
    return variableDeclaration(ctx, cx);

  if (
    has<MultipleAssignmentStmtAltContext>(ctx, "multipleAssignmentStatement")
  ) {
    const s = ctx.multipleAssignmentStatement();
    return {
      kind: "Assignment",
      target: variableNames(s.variableNames(), cx),
      operator: "=",
      value: expression(s.expression(), cx),
      range,
    };
  }

  if (has<AssignmentStmtAltContext>(ctx, "assignmentStatement"))
    return assignment(ctx, cx);

  if (has<ExpressionStmtAltContext>(ctx, "expressionStatement")) {
    const s = ctx.expressionStatement();
    const base = expression(s.expression(), cx);
    const args = s.argumentList();
    return {
      kind: "ExpressionStatement",
      expression: args
        ? methodCall(
            base,
            { args: argumentList(args, cx), trailingComma: false },
            false,
            [],
            range,
          )
        : base,
      range,
    };
  }

  return { kind: "EmptyStatement", range };
}

function variableDeclaration(
  ctx: VariableDeclarationStmtAltContext,
  cx: BuildContext,
): VariableDeclaration {
  const s = ctx.variableDeclaration();
  const init = s._initializer;
  const initializer = init ? expression(init, cx) : null;
  const range = cx.range(ctx);
  const untyped = (i: IdentifierContext): TypedName => {
    const at = cx.range(i);
    checkVariableName(i.getText(), at, cx);
    return {
      kind: "TypedName",
      name: identifier(i, cx),
      type: null,
      range: at,
    };
  };
  // The config grammar has `DEF variableNames = ...` where the script grammar has `DEF nameTypePairs = ...`, and no
  // `DEF nameTypePair`. Only the last alternative has a legacy type.
  const pairs = has<VariableDeclarationContext>(s, "nameTypePairs")
    ? s.nameTypePairs()
    : null;
  const names = has<
    {
      variableNames(): VariableNamesContext | null;
    } & VariableDeclarationContext
  >(s, "variableNames")
    ? s.variableNames()
    : null;
  const pair = has<VariableDeclarationContext>(s, "nameTypePair")
    ? s.nameTypePair()
    : null;
  const targets = pairs
    ? pairs.nameTypePair().map((p) => typedName(p, cx))
    : names
      ? names.identifier().map(untyped)
      : pair
        ? [typedName(pair, cx)]
        : [untyped(s.identifier() as IdentifierContext)];
  const legacy = s.legacyType();
  return {
    kind: "VariableDeclaration",
    def: s.DEF() !== null,
    legacyType: legacy ? legacyType(legacy, cx) : null,
    targets,
    multiple: pairs !== null || names !== null,
    initializer,
    range,
  };
}

function variableName(ctx: ParserRuleContext, cx: BuildContext): Variable {
  const range = cx.range(ctx);
  checkVariableName(ctx.getText(), range, cx);
  return { kind: "Variable", name: ctx.getText(), range };
}

export function variableNames(
  ctx: VariableNamesContext,
  cx: BuildContext,
): TupleTarget {
  return {
    kind: "TupleTarget",
    names: ctx.identifier().map((i) => variableName(i, cx)),
    range: cx.range(ctx),
  };
}

function assignment(
  ctx: AssignmentStmtAltContext,
  cx: BuildContext,
): Assignment {
  const s = ctx.assignmentStatement();
  const range = cx.range(ctx);
  const target = expression(s._target as never, cx);
  const operator = (s._op?.text ?? "=") as AssignmentOperator;
  const value = expression(s._source as never, cx);

  // Upstream looks through parentheses: `(a.b) = c` is valid, `(a) = c` is a one-name tuple, `((a)) = c` fails.
  let inner = target;
  let depth = 0;
  while (inner.kind === "Parenthesized") {
    inner = inner.expression;
    depth++;
  }
  let result: Expression | TupleTarget = target;
  if (inner.kind === "Variable" && depth > 0) {
    if (depth > 1)
      cx.fatal(
        "Nested parenthesis is not allowed in multiple assignment, e.g. ((a)) = b",
        range,
      );
    result = { kind: "TupleTarget", names: [inner], range: target.range };
  } else if (
    inner.kind !== "Variable" &&
    inner.kind !== "Property" &&
    inner.kind !== "Index"
  ) {
    cx.fatal(
      "Invalid assignment target -- must be a variable, index, or property expression",
      range,
    );
  }
  return { kind: "Assignment", target: result, operator, value, range };
}

export function catchClause(
  ctx: CatchClauseContext,
  cx: BuildContext,
): CatchClause {
  // script: `catch (e: A | B)` and `catch (A e)`, in a `catchVariable`; config: `catch (A e)`, inline
  const v = has<CatchClauseContext>(ctx, "catchVariable")
    ? ctx.catchVariable()
    : (ctx as unknown as ReturnType<CatchClauseContext["catchVariable"]>);
  const name = v.identifier() as NonNullable<ReturnType<typeof v.identifier>>;
  const typeList = v.catchTypes();
  const types: ReturnType<typeof qualifiedType>[] =
    typeList?.qualifiedClassName().map((t) => qualifiedType(t, cx)) ?? [];
  const variable = identifier(name, cx);
  // upstream builds one variable per caught type, and checks the name for each
  for (let i = 0; i < Math.max(types.length, 1); i++)
    checkVariableName(variable.name, variable.range, cx);
  const legacy =
    typeList !== null &&
    (typeList.start?.tokenIndex ?? 0) < (name.start?.tokenIndex ?? 0);
  const body = statementOrBlock(ctx.statementOrBlock(), cx);
  const range = cx.range(ctx);
  // Fields are created in source order.
  return legacy
    ? { kind: "Catch", legacy, types, variable, body, range }
    : { kind: "Catch", legacy, variable, types, body, range };
}

export function statementOrBlock(
  ctx: StatementOrBlockContext,
  cx: BuildContext,
): Statement {
  const single = ctx.statement();
  if (single) return statement(single, cx);
  return {
    kind: "Block",
    statements: blockStatements(ctx.blockStatements(), cx),
    range: cx.range(ctx),
  };
}

export function blockStatements(
  ctx: BlockStatementsContext | null | undefined,
  cx: BuildContext,
): Statement[] {
  return ctx ? ctx.statement().map((s) => statement(s, cx)) : [];
}

/** `a: b: stmt`: the labels go on the statement, whose range starts at the first label. */
export function statementOrLabeled(
  ctx: StatementOrLabeledContext,
  cx: BuildContext,
): Statement {
  const label = ctx.identifier();
  const inner = ctx.statementOrLabeled();
  if (!label || !inner)
    return statement(ctx.statement() as StatementContext, cx);
  const labelled = statementOrLabeled(inner, cx);
  const name: Identifier = identifier(label, cx);
  const { labels, ...rest } = labelled;
  // `labels` comes right after `kind`, so that `childNodes` lists the labels first.
  return Object.assign(
    { kind: rest.kind, labels: [name, ...(labels ?? [])] },
    rest,
    { range: spanRanges(name.range, labelled.range) },
  ) as Statement;
}
