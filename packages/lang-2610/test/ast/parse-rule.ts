import type { AstNode, ExpressionStatement } from "@nf-builder/lang-core";
import {
  BailErrorStrategy,
  CharStream,
  CommonTokenStream,
  type ParserATNSimulator,
  type ParserRuleContext,
  PredictionMode,
  Token,
} from "antlr4ng";
import { BuildContext } from "../../src/ast/build/context.ts";
import {
  closure,
  expression,
  mapEntry,
  namedArgument,
} from "../../src/ast/build/expressions.ts";
import {
  catchClause,
  statement,
  statementOrBlock,
  statementOrLabeled,
  variableNames,
} from "../../src/ast/build/statements.ts";
import {
  identifier,
  legacyType,
  parameter,
  typedName,
  typeRef,
} from "../../src/ast/build/types.ts";
import { ScriptLexer } from "../../src/generated/ScriptLexer.ts";
import { ScriptParser } from "../../src/generated/ScriptParser.ts";

// Re-parse a node's source slice on its own by the node's own grammar rule (pure LL, bailing out at the first error),
// build it with the same builder function, and hand the result back so it can be compared with the original node.

type Rule = {
  parse: (parser: ScriptParser) => ParserRuleContext;
  build: (ctx: never, cx: BuildContext) => unknown;
};
const rule = <C extends ParserRuleContext>(
  parse: (parser: ScriptParser) => C,
  build: (ctx: C, cx: BuildContext) => unknown,
): Rule => ({ parse, build: build as Rule["build"] });

const STATEMENT_KINDS = new Set([
  "ExpressionStatement",
  "VariableDeclaration",
  "Assignment",
  "If",
  "TryCatch",
  "Return",
  "Throw",
  "Assert",
  "EmptyStatement",
]);
const EXPRESSION_KINDS = new Set([
  "Variable",
  "Number",
  "String",
  "Boolean",
  "Null",
  "GString",
  "List",
  "Map",
  "Closure",
  "Property",
  "Index",
  "MethodCall",
  "Call",
  "New",
  "Unary",
  "Binary",
  "Cast",
  "TypeTest",
  "Ternary",
  "Elvis",
  "Parenthesized",
  "IncompleteExpression",
]);
/** Kinds that have no rule of their own: they are built inside a token or by a parent only. */
export const NOT_REPARSED = new Set([
  "Script",
  "Interpolation",
  "GStringText",
  "Wildcard",
  "InvalidDeclaration",
]);

/** The rules to try, in order, for `node`; `null` for kinds that are not re-parsed. */
function rulesFor(node: AstNode): Rule[] | null {
  const n = node as AstNode & Record<string, unknown>;
  if (NOT_REPARSED.has(node.kind)) return null;
  if (node.kind === "Block")
    return [rule((p) => p.statementOrBlock(), statementOrBlock)];
  if (STATEMENT_KINDS.has(node.kind))
    return n.labels
      ? [rule((p) => p.statementOrLabeled(), statementOrLabeled)]
      : [rule((p) => p.statement(), statement)];
  if (EXPRESSION_KINDS.has(node.kind)) {
    // a command call (`println 'x'`) is an expression statement, not an expression
    if (
      (node.kind === "MethodCall" || node.kind === "Call") &&
      n.parens === false &&
      (n.args as unknown[]).length > 0
    )
      return [
        rule(
          (p) => p.statement(),
          (ctx, cx) => (statement(ctx, cx) as ExpressionStatement).expression,
        ),
      ];
    const rules = [rule((p) => p.expression(), expression)];
    if (node.kind === "Closure")
      rules.push(rule((p) => p.closureWithLabels(), closure));
    return rules;
  }
  switch (node.kind) {
    case "Identifier":
      return [
        rule((p) => p.identifier(), identifier),
        rule((p) => p.keywords(), identifier),
      ];
    case "TypedName":
      return [rule((p) => p.nameTypePair(), typedName)];
    case "Parameter":
      return [rule((p) => p.formalParameter(), parameter)];
    case "Catch":
      return [rule((p) => p.catchClause(), catchClause)];
    case "MapEntry":
      return [rule((p) => p.mapEntry(), mapEntry)];
    case "NamedArgument":
      return [rule((p) => p.namedArg(), namedArgument)];
    case "TypeRef":
      return [rule((p) => p.type_(), typeRef)];
    case "LegacyType":
      return [rule((p) => p.legacyType(), legacyType)];
    case "TupleTarget":
      // `(a) = b` has one name, which `variableNames` does not accept
      return (n.names as unknown[]).length > 1
        ? [rule((p) => p.variableNames(), variableNames)]
        : null;
    default:
      return null;
  }
}

export const hasRule = (node: AstNode) => rulesFor(node) !== null;

/** Parse `slice` by `parse` to the end of the input, bailing out at the first error. */
function parseSlice(slice: string, parse: Rule["parse"]) {
  const lexer = new ScriptLexer(CharStream.fromString(slice));
  lexer.removeErrorListeners();
  const tokens = new CommonTokenStream(lexer);
  const parser = new ScriptParser(tokens);
  parser.removeErrorListeners();
  parser.errorHandler = new BailErrorStrategy();
  (parser.interpreter as ParserATNSimulator).predictionMode = PredictionMode.LL;
  const ctx = parse(parser);
  if (tokens.LA(1) !== Token.EOF)
    throw new Error(`unconsumed input from token ${tokens.LT(1)?.text}`);
  return { ctx, tokens };
}

/** The node built from the slice alone (offsets relative to the slice), or the reason it could not be. */
export function reparse(
  node: AstNode,
  text: string,
  typesEnabled: boolean,
): { node: unknown } | { skip: true } | { error: string } {
  const rules = rulesFor(node);
  if (!rules) return { skip: true };
  const slice = text.slice(node.range.start, node.range.end);
  const errors: string[] = [];
  for (const r of rules) {
    try {
      const { ctx, tokens } = parseSlice(slice, r.parse);
      const cx = new BuildContext(slice, tokens);
      cx.typesEnabled = typesEnabled;
      return { node: r.build(ctx as never, cx) };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    error: `${node.kind} slice ${JSON.stringify(slice)} does not re-parse: ${errors.join("; ")}`,
  };
}
