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
  featureFlagName,
  includeEntry,
  outputDecl,
  param,
  scriptDeclaration,
} from "../../src/ast/build/declarations.ts";
import {
  closure,
  expression,
  mapEntry,
  namedArgument,
} from "../../src/ast/build/expressions.ts";
import {
  implicitExec,
  legacyInputs,
  legacyOutputs,
  namedOutput,
  processDirectives,
  processStage,
  processStub,
  processTopics,
  processWhen,
  recordInput,
  tupleInput,
  typedInputs,
  typedOutputs,
} from "../../src/ast/build/process.ts";
import { directive } from "../../src/ast/build/sections.ts";
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

export const DECLARATION_KINDS = new Set([
  "FeatureFlag",
  "Include",
  "Import",
  "ParamsBlock",
  "LegacyParam",
  "Record",
  "Enum",
  "Process",
  "Agent",
  "Workflow",
  "OutputBlock",
  "Function",
  "IncompleteDeclaration",
]);

type Parents = readonly AstNode[];
type Fields = AstNode & Record<string, unknown>;

/** Whether the process, whose section `node` is, is a typed one. */
const sectionOwner = (parents: Parents) => parents[0] as Fields | undefined;

/**
 * Statements of the directive-like sections (directives, stage, and the legacy inputs and outputs) are normalised by
 * `directive()` as they are built.
 */
function isDirectiveItem(parents: Parents): boolean {
  const section = parents[0] as Fields | undefined;
  const owner = parents[1] as Fields | undefined;
  if (section?.kind !== "Section" || !owner) return false;
  if (owner.kind === "Process" || owner.kind === "Agent") {
    if (owner.directives === section || owner.stage === section) return true;
    if (owner.kind === "Process" && owner.typed === false)
      return owner.inputs === section || owner.outputs === section;
  }
  return false;
}

/** The re-parse rules of a section of a process; `agent` and workflow sections have no rule of their own. */
function sectionRules(section: Fields, parents: Parents): Rule[] | null {
  const owner = sectionOwner(parents);
  if (owner?.kind !== "Process") return null;
  const typed = owner.typed === true;
  if (owner.directives === section)
    return [rule((p) => p.processDirectives(), processDirectives)];
  if (owner.inputs === section)
    return [rule((p) => p.processInputs(), typed ? typedInputs : legacyInputs)];
  if (owner.stage === section)
    return [rule((p) => p.processStage(), processStage)];
  if (owner.topics === section)
    return [rule((p) => p.processTopics(), processTopics)];
  if (owner.outputs === section)
    return [
      rule((p) => p.processOutputs(), typed ? typedOutputs : legacyOutputs),
    ];
  if (owner.when === section)
    return [rule((p) => p.processWhen(), processWhen)];
  if (owner.stub === section)
    return [rule((p) => p.processStub(), processStub)];
  if (owner.exec === section)
    return section.label
      ? [rule((p) => p.processExec(), processStub)]
      : [rule((p) => p.blockStatements(), implicitExec)];
  return null;
}

/** Kinds, and sections of an agent or workflow, that are not re-parsed. */
export function notReparsed(node: AstNode, parents: Parents): boolean {
  if (NOT_REPARSED.has(node.kind)) return true;
  if (node.kind !== "Section") return false;
  const owner = sectionOwner(parents);
  return owner?.kind === "Agent" || owner?.kind === "Workflow";
}

/** The rules to try, in order, for `node`; `null` for kinds that are not re-parsed. */
function rulesFor(node: AstNode, parents: Parents): Rule[] | null {
  const n = node as Fields;
  if (NOT_REPARSED.has(node.kind)) return null;
  if (DECLARATION_KINDS.has(node.kind))
    return [rule((p) => p.scriptDeclaration(), scriptDeclaration)];
  if (node.kind === "Section") return sectionRules(n, parents);
  if (node.kind === "Block")
    return [rule((p) => p.statementOrBlock(), statementOrBlock)];
  if (STATEMENT_KINDS.has(node.kind)) {
    if (n.labels)
      return [rule((p) => p.statementOrLabeled(), statementOrLabeled)];
    if (node.kind === "ExpressionStatement" && isDirectiveItem(parents))
      return [
        rule(
          (p) => p.statement(),
          (ctx, cx) => directive(statement(ctx, cx), "", cx),
        ),
      ];
    return [rule((p) => p.statement(), statement)];
  }
  if (EXPRESSION_KINDS.has(node.kind)) {
    // the call that `directive()` made from `stdout` or `cpus -1`
    if (
      node.kind === "MethodCall" &&
      parents[0]?.kind === "ExpressionStatement" &&
      isDirectiveItem(parents.slice(1))
    )
      return [
        rule(
          (p) => p.statement(),
          (ctx, cx) =>
            (directive(statement(ctx, cx), "", cx) as ExpressionStatement)
              .expression,
        ),
      ];
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
      // the dotted name of a feature flag
      if (
        parents[0]?.kind === "FeatureFlag" &&
        (parents[0] as Fields).name === node
      )
        return [rule((p) => p.featureFlagName(), featureFlagName)];
      return [
        rule((p) => p.identifier(), identifier),
        rule((p) => p.keywords(), identifier),
      ];
    case "TypedName":
      return [rule((p) => p.nameTypePair(), typedName)];
    case "Parameter":
      return [rule((p) => p.formalParameter(), parameter)];
    case "IncludeEntry":
      return [rule((p) => p.includeName(), includeEntry)];
    case "Param":
      return [rule((p) => p.paramDeclaration(), param)];
    case "RecordInput":
      return [rule((p) => p.processRecordInput(), recordInput)];
    case "TupleInput":
      return [rule((p) => p.processTupleInput(), tupleInput)];
    case "NamedOutput":
      return [rule((p) => p.processOutput(), namedOutput)];
    case "Output":
      return [rule((p) => p.outputDeclaration(), outputDecl)];
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

export const hasRule = (node: AstNode, parents: Parents) =>
  rulesFor(node, parents) !== null;

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

/**
 * A rule parsed alone has no outer context, so ANTLR lets the rule end anywhere. That can cost an ambiguous slice its
 * type arguments: `logs: Bag<Path>` followed by `config: Path` stops before the `<`. Parsing the slice together with
 * the text that follows it in the file gives the parser what it has in the file; the rule must end where the slice does.
 */
function parseSliceWithFollow(
  slice: string,
  follow: () => string,
  parse: Rule["parse"],
) {
  const lexer = new ScriptLexer(CharStream.fromString(slice + follow()));
  lexer.removeErrorListeners();
  const tokens = new CommonTokenStream(lexer);
  const parser = new ScriptParser(tokens);
  parser.removeErrorListeners();
  parser.errorHandler = new BailErrorStrategy();
  (parser.interpreter as ParserATNSimulator).predictionMode = PredictionMode.LL;
  const ctx = parse(parser);
  if ((ctx.stop?.stop ?? -1) + 1 > [...slice].length)
    throw new Error(`unconsumed input from token ${tokens.LT(1)?.text}`);
  return { ctx, tokens };
}

function parseSliceWithFallback(
  slice: string,
  follow: () => string,
  parse: Rule["parse"],
) {
  try {
    return parseSlice(slice, parse);
  } catch (error) {
    if (!String((error as Error).message).startsWith("unconsumed input"))
      throw error;
    return parseSliceWithFollow(slice, follow, parse);
  }
}

/** The node built from the slice alone (offsets relative to the slice), or the reason it could not be. */
export function reparse(
  node: AstNode,
  text: string,
  scriptTypesEnabled: boolean,
  parents: Parents,
): { node: unknown } | { skip: true } | { error: string } {
  const rules = rulesFor(node, parents);
  if (!rules) return { skip: true };
  // typed or legacy as the enclosing process or workflow was built; a legacy parameter exists only without types
  const owner = [node, ...parents].find(
    (a) => a.kind === "Process" || a.kind === "Workflow",
  ) as Fields | undefined;
  const typesEnabled =
    node.kind === "LegacyParam"
      ? false
      : owner
        ? owner.typed === true
        : scriptTypesEnabled;
  const slice = text.slice(node.range.start, node.range.end);
  const follow = () => text.slice(node.range.end);
  const errors: string[] = [];
  for (const r of rules) {
    try {
      const { ctx, tokens } = parseSliceWithFallback(slice, follow, r.parse);
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
