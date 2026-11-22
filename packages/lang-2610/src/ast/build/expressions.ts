// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `expression` and everything under it (Apache-2.0; see ../../../grammar/NOTICE).
//
// Shared with the config grammar (F-103). ConfigParser.g4 repeats the script grammar's expression rules (`expression`,
// `primary`, `pathElement`, `closure`, `closureWithLabels`, `list`, `map`, `arguments`, `argumentList`, `namedArg`,
// `gstring`, `creator`, `literal`, `parExpression`, `stringLiteral`) with the same names and shapes, so a config parse
// tree can be passed to `expression` as it is (cast to the script context type, which only matters to the compiler).
// Where the grammars differ, this layer copes:
//   - `incompleteExprAlt` exists only in the script grammar; its absence is never tested for.
//   - the config `identifier` and `keywords` rules list fewer keywords (`INCLUDE_CONFIG` instead of the script ones);
//     only their text is read.
//   - `type` has no `?` in config, `typeArguments` lists `type` and not `typeArgument`, and `formalParameter` has only the
//     legacy alternative: types.ts checks for each accessor before it calls it.
// Token types are numbered differently in the two lexers, so operators are read from token text, and alternatives are told
// apart by the accessors they have (alt.ts), never by class or token type. Nothing here imports the config parser.
import type {
  Argument,
  BinaryOperator,
  Closure,
  Expression,
  Identifier,
  MapEntry,
  NamedArgument,
  Navigation,
  Range,
  StringLiteral,
  UnaryOperator,
} from "@nf-builder/lang-core";
import type { Token } from "antlr4ng";
import type {
  ArgumentListContext,
  ArgumentsContext,
  ClosureContext,
  ClosureWithLabelsContext,
  ConditionalExprAltContext,
  ExpressionContext,
  IncompleteExprAltContext,
  IndexPathExprAltContext,
  ListContext,
  LiteralContext,
  MapContext,
  MapEntryContext,
  NamedArgContext,
  NamedPropertyContext,
  NewPrmrAltContext,
  ParenPrmrAltContext,
  PathElementContext,
  PathExprAltContext,
  PrimaryContext,
  PropertyPathExprAltContext,
  RelationalCastExprAltContext,
  RelationalTypeExprAltContext,
  StringLiteralAltContext,
  UnaryAddExprAltContext,
  UnaryNotExprAltContext,
} from "../../generated/ScriptParser.ts";
import { spanRanges } from "../positions.ts";
import { has } from "./alt.ts";
import type { BuildContext } from "./context.ts";
import { gstring, numberLiteral, stringLiteral } from "./literals.ts";
import { unparen } from "./sections.ts";
import { blockStatements, statementOrLabeled } from "./statements.ts";
import { checkVariableName, identifier, parameter, typeRef } from "./types.ts";

// The labelled fields of the expression alternatives (`left=expression`, `op=...`), set only on the alternative that has them.
type Labels = {
  _left?: ExpressionContext;
  _right?: ExpressionContext;
  _op?: Token | null;
  _condition?: ExpressionContext;
  _tb?: ExpressionContext;
  _fb?: ExpressionContext;
  _dlOp?: Token | null;
  _tgOp?: Token | null;
  _dgOp?: Token | null;
  _riOp?: Token | null;
  _reOp?: Token | null;
};

const opText = (token: Token) => (token.text ?? "").replace(/\s+/g, "");

export function expression(
  ctx: ExpressionContext,
  cx: BuildContext,
): Expression {
  if (has<PathExprAltContext>(ctx, "pathElement")) {
    return pathExpression(ctx, cx);
  }
  const range = cx.range(ctx);
  const l = ctx as unknown as Labels;

  if (l._condition) {
    const alt = ctx as ConditionalExprAltContext;
    const condition = expression(l._condition, cx);
    if (alt.ELVIS())
      return {
        kind: "Elvis",
        condition,
        alternate: expression(l._fb as ExpressionContext, cx),
        range,
      };
    return {
      kind: "Ternary",
      condition,
      consequent: expression(l._tb as ExpressionContext, cx),
      alternate: expression(l._fb as ExpressionContext, cx),
      range,
    };
  }

  const shift = l._dlOp ?? l._dgOp ?? l._tgOp ?? l._riOp ?? l._reOp;
  if (shift && l._left && l._right) {
    const operator = l._dlOp
      ? "<<"
      : l._dgOp
        ? ">>"
        : l._tgOp
          ? ">>>"
          : (opText(shift) as "..");
    return {
      kind: "Binary",
      operator,
      left: expression(l._left, cx),
      right: expression(l._right, cx),
      range,
    };
  }

  if (l._left && l._op) {
    const operator = opText(l._op);
    if (operator === "as")
      return {
        kind: "Cast",
        operand: expression(l._left, cx),
        type: typeRef((ctx as RelationalCastExprAltContext).type(), cx),
        range,
      };
    if (operator === "instanceof" || operator === "!instanceof")
      return {
        kind: "TypeTest",
        operator,
        operand: expression(l._left, cx),
        type: typeRef((ctx as RelationalTypeExprAltContext).type(), cx),
        range,
      };
    return {
      kind: "Binary",
      operator: operator as BinaryOperator,
      left: expression(l._left, cx),
      right: expression(l._right as ExpressionContext, cx),
      range,
    };
  }

  if (l._op)
    return {
      kind: "Unary",
      operator: opText(l._op) as UnaryOperator,
      operand: expression(
        (ctx as UnaryNotExprAltContext | UnaryAddExprAltContext).expression(),
        cx,
      ),
      range,
    };

  const alt = ctx as IncompleteExprAltContext;
  const object = expression(alt.expression(), cx);
  cx.error("Incomplete expression", range);
  return {
    kind: "IncompleteExpression",
    object,
    navigation: alt.SPREAD_DOT() ? "*." : alt.SAFE_DOT() ? "?." : ".",
    range,
  };
}

// Path expressions

function pathExpression(ctx: PathExprAltContext, cx: BuildContext): Expression {
  let result = primary(ctx.primary(), cx);
  for (const element of ctx.pathElement())
    result = pathElement(result, element, cx);
  return result;
}

function pathElement(
  object: Expression,
  ctx: PathElementContext,
  cx: BuildContext,
): Expression {
  const range = spanRanges(object.range, cx.range(ctx));

  if (has<PropertyPathExprAltContext>(ctx, "namedProperty")) {
    const navigation: Navigation = ctx.SPREAD_DOT()
      ? "*."
      : ctx.SAFE_DOT()
        ? "?."
        : ".";
    return {
      kind: "Property",
      object,
      navigation,
      property: namedProperty(ctx.namedProperty(), cx),
      range,
    };
  }

  if (has<IndexPathExprAltContext>(ctx, "indexPropertyArgs"))
    return {
      kind: "Index",
      object,
      indices: ctx
        .indexPropertyArgs()
        .expressionList()
        .expression()
        .map((e) => expression(e, cx)),
      range,
    };

  if (
    has<{ arguments(): ArgumentsContext } & PathElementContext>(
      ctx,
      "arguments",
    )
  ) {
    const args = ctx.arguments();
    return methodCall(
      object,
      {
        args: argumentList(args.argumentList(), cx),
        trailingComma: args.COMMA() !== null,
      },
      true,
      [],
      range,
    );
  }

  // `m { }`, `obj.m { }`, `f(x) { }`, `<expr> { }`
  const closureCtx = has<
    { closureWithLabels(): ClosureWithLabelsContext } & PathElementContext
  >(ctx, "closureWithLabels")
    ? ctx.closureWithLabels()
    : (ctx as unknown as { closure(): ClosureContext }).closure();
  const trailing = closure(closureCtx, cx);
  // Upstream adds the closure to the call's arguments even when the call is in parentheses (`(foo(1)) { }`,
  // ScriptAstBuilder.java#L1547-L1553), so the parentheses are dropped there.
  const target = unparen(object);
  if (target.kind === "MethodCall" || target.kind === "Call")
    return { ...target, closures: [...target.closures, trailing], range };
  return methodCall(
    object,
    { args: [], trailingComma: false },
    false,
    [trailing],
    range,
  );
}

/**
 * A call on `caller`, as upstream's `methodCall`: `obj.m(...)` and `m(...)` are method calls, anything else is a call
 * of the value (upstream `.call`). A parenthesised caller is a `Parenthesized` node here, so it is never a method name.
 */
export function methodCall(
  caller: Expression,
  call: { args: Argument[]; trailingComma: boolean },
  parens: boolean,
  closures: Closure[],
  range: Range,
): Expression {
  if (caller.kind === "Property")
    return {
      kind: "MethodCall",
      receiver: caller.object,
      navigation: caller.navigation,
      method: caller.property,
      ...call,
      parens,
      closures,
      range,
    };
  if (caller.kind === "Variable")
    return {
      kind: "MethodCall",
      receiver: null,
      navigation: null,
      method: { kind: "Identifier", name: caller.name, range: caller.range },
      ...call,
      parens,
      closures,
      range,
    };
  if (caller.kind === "String")
    return {
      kind: "MethodCall",
      receiver: null,
      navigation: null,
      method: caller,
      ...call,
      parens,
      closures,
      range,
    };
  return { kind: "Call", callee: caller, ...call, parens, closures, range };
}

export function argumentList(
  ctx: ArgumentListContext | null,
  cx: BuildContext,
): Argument[] {
  if (!ctx) return [];
  const names = new Set<string>();
  return ctx.argumentListElement().map((element) => {
    const named = element.namedArg();
    if (!named)
      return expression(element.expression() as ExpressionContext, cx);
    const argument = namedArgument(named, cx);
    // the key's text: an identifier's name, or a string's value
    const name =
      argument.name.kind === "String"
        ? argument.name.value
        : argument.name.name;
    if (names.has(name))
      cx.fatal(`Duplicated named argument '${name}' found`, argument.range);
    names.add(name);
    return argument;
  });
}

export function namedArgument(
  ctx: NamedArgContext,
  cx: BuildContext,
): NamedArgument {
  return {
    kind: "NamedArgument",
    name: namedProperty(ctx.namedProperty(), cx),
    value: expression(ctx.expression(), cx),
    range: cx.range(ctx),
  };
}

function namedProperty(
  ctx: NamedPropertyContext,
  cx: BuildContext,
): Identifier | StringLiteral {
  const keyword = ctx.keywords();
  if (keyword) return identifier(keyword, cx);
  const name = ctx.identifier();
  if (name) return identifier(name, cx);
  return stringLiteral(ctx.stringLiteral() as never, cx);
}

// Primary expressions

export function primary(ctx: PrimaryContext, cx: BuildContext): Expression {
  const range = cx.range(ctx);

  if (has<{ identifier(): never } & PrimaryContext>(ctx, "identifier")) {
    checkVariableName(ctx.getText(), range, cx);
    return { kind: "Variable", name: ctx.getText(), range };
  }
  if (has<{ literal(): LiteralContext } & PrimaryContext>(ctx, "literal"))
    return literal(ctx.literal(), cx);
  if (has<{ gstring(): never } & PrimaryContext>(ctx, "gstring"))
    return gstring(ctx.gstring(), cx);
  if (has<NewPrmrAltContext>(ctx, "creator")) {
    const creator = ctx.creator();
    const args = creator.arguments();
    return {
      kind: "New",
      type: typeRef(creator.createdName(), cx),
      args: argumentList(args.argumentList(), cx),
      trailingComma: args.COMMA() !== null,
      range,
    };
  }
  if (has<ParenPrmrAltContext>(ctx, "parExpression"))
    return {
      kind: "Parenthesized",
      expression: expression(ctx.parExpression().expression(), cx),
      range,
    };
  if (has<{ closure(): ClosureContext } & PrimaryContext>(ctx, "closure"))
    return closure(ctx.closure(), cx);
  if (has<{ list(): ListContext } & PrimaryContext>(ctx, "list"))
    return list(ctx.list(), cx);
  if (has<{ map(): MapContext } & PrimaryContext>(ctx, "map"))
    return map(ctx.map(), cx);
  // a built-in type used as a value, e.g. `int`
  return { kind: "Variable", name: ctx.getText(), range };
}

function literal(ctx: LiteralContext, cx: BuildContext): Expression {
  if (has<StringLiteralAltContext>(ctx, "stringLiteral"))
    return stringLiteral(ctx.stringLiteral(), cx);
  if (has<{ BooleanLiteral(): never } & LiteralContext>(ctx, "BooleanLiteral"))
    return {
      kind: "Boolean",
      value: ctx.getText() === "true",
      range: cx.range(ctx),
    };
  if (has<{ NullLiteral(): never } & LiteralContext>(ctx, "NullLiteral"))
    return { kind: "Null", range: cx.range(ctx) };
  return numberLiteral(ctx as never, cx);
}

export function closure(
  ctx: ClosureContext | ClosureWithLabelsContext,
  cx: BuildContext,
): Closure {
  const list = ctx.formalParameterList();
  return {
    kind: "Closure",
    params: ctx.ARROW()
      ? (list?.formalParameter() ?? []).map((p) => parameter(p, cx))
      : null,
    body: has<ClosureWithLabelsContext>(ctx, "blockStatementsWithLabels")
      ? ctx
          .blockStatementsWithLabels()
          .statementOrLabeled()
          .map((s) => statementOrLabeled(s, cx))
      : blockStatements((ctx as ClosureContext).blockStatements(), cx),
    range: cx.range(ctx),
  };
}

function list(ctx: ListContext, cx: BuildContext): Expression {
  const elements = ctx.expressionList();
  const comma = ctx.COMMA();
  if (comma && !elements)
    cx.fatal(
      "Empty list literal should not contain any comma(,)",
      cx.tokenRange(comma.symbol),
    );
  return {
    kind: "List",
    elements: elements
      ? elements.expression().map((e) => expression(e, cx))
      : [],
    trailingComma: comma !== null,
    range: cx.range(ctx),
  };
}

function map(ctx: MapContext, cx: BuildContext): Expression {
  const entries = ctx.mapEntryList();
  return {
    kind: "Map",
    entries: entries ? entries.mapEntry().map((e) => mapEntry(e, cx)) : [],
    trailingComma: ctx.COMMA() !== null,
    range: cx.range(ctx),
  };
}

export function mapEntry(ctx: MapEntryContext, cx: BuildContext): MapEntry {
  const label = ctx.mapEntryLabel();
  const keywords = label.keywords();
  let key: Identifier | Expression;
  if (keywords) {
    key = identifier(keywords, cx);
  } else {
    const k = primary(label.primary() as PrimaryContext, cx);
    // a bare name is a string key; `(name)` is the variable's value
    key =
      k.kind === "Variable"
        ? { kind: "Identifier", name: k.name, range: k.range }
        : k;
  }
  return {
    kind: "MapEntry",
    key,
    value: expression(ctx.expression(), cx),
    range: cx.range(ctx),
  };
}
