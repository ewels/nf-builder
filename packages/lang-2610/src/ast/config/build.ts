// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/config/parser/ConfigAstBuilder.java
// `compilationUnit` and the config statement rules under it (Apache-2.0; see ../../../grammar/NOTICE). Values and
// closure bodies are built by the shared expression and statement builders in ../build/.
import type {
  ConfigApply,
  ConfigAssign,
  ConfigAst,
  ConfigBlock,
  ConfigInclude,
  ConfigIncomplete,
  ConfigInvalid,
  ConfigName,
  ConfigSelector,
  ConfigStatement,
  Identifier,
  Statement,
} from "@nf-builder/lang-core";
import {
  type CompilationUnitContext,
  ConfigApplyBlockBlockStmtAltContext,
  type ConfigApplyBlockContext,
  ConfigApplyBlockStmtAltContext,
  type ConfigApplyContext,
  ConfigAssignBlockStmtAltContext,
  type ConfigAssignContext,
  ConfigAssignStmtAltContext,
  ConfigBlockBlockStmtAltContext,
  type ConfigBlockContext,
  type ConfigBlockStatementContext,
  ConfigBlockStmtAltContext,
  ConfigIncludeBlockStmtAltContext,
  type ConfigIncludeContext,
  ConfigIncludeStmtAltContext,
  ConfigIncompleteBlockStmtAltContext,
  type ConfigIncompleteContext,
  ConfigIncompleteStmtAltContext,
  ConfigInvalidBlockStmtAltContext,
  ConfigInvalidStmtAltContext,
  type ConfigPrimaryContext,
  ConfigSelectorBlockStmtAltContext,
  type ConfigSelectorContext,
  type ConfigStatementContext,
  type InvalidStatementContext,
} from "../../generated/ConfigParser.ts";
import type {
  ArgumentListContext,
  ExpressionContext,
  IdentifierContext,
  StatementContext,
  StringLiteralContext,
} from "../../generated/ScriptParser.ts";
import type { BuildContext } from "../build/context.ts";
import { argumentList, expression } from "../build/expressions.ts";
import { stringLiteral } from "../build/literals.ts";
import { statement } from "../build/statements.ts";
import { identifier } from "../build/types.ts";

// The config parse tree's expression contexts have the shapes the script builders read (see build/expressions.ts).
const expr = (ctx: unknown, cx: BuildContext) =>
  expression(ctx as ExpressionContext, cx);

function configName(ctx: ConfigPrimaryContext, cx: BuildContext): ConfigName {
  const range = cx.range(ctx);
  const string = ctx.stringLiteral();
  if (string)
    return {
      kind: "ConfigName",
      name: stringLiteral(string as unknown as StringLiteralContext, cx).value,
      form: "string",
      range,
    };
  const name = ctx.identifier();
  if (name)
    return {
      kind: "ConfigName",
      name: name.getText(),
      form: "identifier",
      range,
    };
  return {
    kind: "ConfigName",
    name: ctx.getText(),
    form: "builtInType",
    range,
  };
}

function configInclude(
  ctx: ConfigIncludeContext,
  cx: BuildContext,
): ConfigInclude {
  return {
    kind: "ConfigInclude",
    source: expr(ctx.expression(), cx),
    range: cx.range(ctx),
  };
}

function configAssign(
  ctx: ConfigAssignContext,
  cx: BuildContext,
): ConfigAssign {
  return {
    kind: "ConfigAssign",
    path: ctx
      .configAssignPath()
      .configPrimary()
      .map((p) => configName(p, cx)),
    value: expr(ctx.expression(), cx),
    range: cx.range(ctx),
  };
}

function configApply(ctx: ConfigApplyContext, cx: BuildContext): ConfigApply {
  return {
    kind: "ConfigApply",
    name: identifier(
      ctx.identifier() as unknown as IdentifierContext,
      cx,
    ) as Identifier,
    args: argumentList(
      ctx.argumentList() as unknown as ArgumentListContext,
      cx,
    ),
    range: cx.range(ctx),
  };
}

function configApplyBlock(ctx: ConfigApplyBlockContext, cx: BuildContext) {
  const result = {
    kind: "ConfigApplyBlock" as const,
    name: configName(ctx.configPrimary(), cx),
    statements: ctx.configApply().map((a) => configApply(a, cx)),
    range: cx.range(ctx),
  };
  if (result.name.name !== "plugins")
    cx.error(
      "Config settings must be assigned with an equals sign (`=`)",
      result.range,
    );
  return result;
}

function configIncomplete(
  ctx: ConfigIncompleteContext,
  cx: BuildContext,
): ConfigIncomplete {
  const primaries = ctx.configPrimary();
  const result: ConfigIncomplete = {
    kind: "ConfigIncomplete",
    path: primaries.map((p) => configName(p, cx)),
    trailingDot: ctx.DOT().length === primaries.length,
    range: cx.range(ctx),
  };
  cx.error("Incomplete statement", result.range);
  return result;
}

/** An if, try or `def`: reported, and kept (upstream drops it). */
function configInvalid(
  ctx: InvalidStatementContext,
  cx: BuildContext,
): ConfigInvalid {
  const range = cx.range(ctx);
  const message = ctx.ifElseStatement()
    ? "If statements cannot be mixed with config statements"
    : ctx.tryCatchStatement()
      ? "Try-catch blocks cannot be mixed with config statements"
      : ctx.variableDeclaration()
        ? "Variable declarations cannot be mixed with config statements"
        : "Invalid config statement";
  cx.error(message, range);
  // `statement` tells the alternatives apart by the accessors a context has; `invalidStatement` has all three, so hand it
  // a view with only the one that matched.
  const only = ctx.ifElseStatement()
    ? { ifElseStatement: () => ctx.ifElseStatement() }
    : ctx.tryCatchStatement()
      ? { tryCatchStatement: () => ctx.tryCatchStatement() }
      : { variableDeclaration: () => ctx.variableDeclaration() };
  const view = { start: ctx.start, stop: ctx.stop, ...only };
  return {
    kind: "ConfigInvalid",
    statement: statement(
      view as unknown as StatementContext,
      cx,
    ) as ConfigInvalid["statement"],
    range,
  };
}

function configBlock(ctx: ConfigBlockContext, cx: BuildContext): ConfigBlock {
  return {
    kind: "ConfigBlock",
    name: configName(ctx.configPrimary(), cx),
    statements: ctx.configBlockStatement().map((s) => blockStatement(s, cx)),
    range: cx.range(ctx),
  };
}

function configSelector(
  ctx: ConfigSelectorContext,
  cx: BuildContext,
): ConfigSelector {
  const kind = ctx.Identifier().symbol;
  return {
    kind: "ConfigSelector",
    selector: {
      kind: "ConfigName",
      name: kind.text ?? "",
      form: "identifier",
      range: cx.tokenRange(kind),
    },
    target: configName(ctx.configPrimary(), cx),
    statements: ctx.configBlockStatement().map((s) => blockStatement(s, cx)),
    range: cx.range(ctx),
  };
}

function topStatement(
  ctx: ConfigStatementContext,
  cx: BuildContext,
): ConfigStatement {
  if (ctx instanceof ConfigIncludeStmtAltContext)
    return configInclude(ctx.configInclude(), cx);
  if (ctx instanceof ConfigApplyBlockStmtAltContext)
    return configApplyBlock(ctx.configApplyBlock(), cx);
  if (ctx instanceof ConfigAssignStmtAltContext)
    return configAssign(ctx.configAssign(), cx);
  if (ctx instanceof ConfigBlockStmtAltContext)
    return configBlock(ctx.configBlock(), cx);
  if (ctx instanceof ConfigIncompleteStmtAltContext)
    return configIncomplete(ctx.configIncomplete(), cx);
  if (ctx instanceof ConfigInvalidStmtAltContext)
    return configInvalid(ctx.invalidStatement(), cx);
  return cx.fatal(`Invalid statement: ${ctx.getText()}`, cx.range(ctx));
}

function blockStatement(
  ctx: ConfigBlockStatementContext,
  cx: BuildContext,
): ConfigStatement {
  if (ctx instanceof ConfigIncludeBlockStmtAltContext)
    return configInclude(ctx.configInclude(), cx);
  if (ctx instanceof ConfigApplyBlockBlockStmtAltContext)
    return configApplyBlock(ctx.configApplyBlock(), cx);
  if (ctx instanceof ConfigAssignBlockStmtAltContext)
    return configAssign(ctx.configAssign(), cx);
  if (ctx instanceof ConfigBlockBlockStmtAltContext)
    return configBlock(ctx.configBlock(), cx);
  if (ctx instanceof ConfigSelectorBlockStmtAltContext)
    return configSelector(ctx.configSelector(), cx);
  if (ctx instanceof ConfigIncompleteBlockStmtAltContext)
    return configIncomplete(ctx.configIncomplete(), cx);
  if (ctx instanceof ConfigInvalidBlockStmtAltContext)
    return configInvalid(ctx.invalidStatement(), cx);
  return cx.fatal(
    `Invalid statement in config block: ${ctx.getText()}`,
    cx.range(ctx),
  );
}

/** The config root: its statements in source order. The comment list is filled by `parseConfigAst`. */
export function buildConfig(
  tree: CompilationUnitContext,
  cx: BuildContext,
): ConfigAst {
  return {
    kind: "ConfigFile",
    statements: tree.configStatement().map((s) => topStatement(s, cx)),
    comments: [],
    range: cx.index.range(0, cx.index.size),
  };
}

export type { Statement };
