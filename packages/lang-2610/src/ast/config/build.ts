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
} from "@nf-builder/lang-core";
import type {
  CompilationUnitContext,
  ConfigApplyBlockContext,
  ConfigApplyBlockStmtAltContext,
  ConfigApplyContext,
  ConfigAssignContext,
  ConfigAssignStmtAltContext,
  ConfigBlockContext,
  ConfigBlockStatementContext,
  ConfigBlockStmtAltContext,
  ConfigIncludeContext,
  ConfigIncludeStmtAltContext,
  ConfigIncompleteContext,
  ConfigIncompleteStmtAltContext,
  ConfigInvalidStmtAltContext,
  ConfigPrimaryContext,
  ConfigSelectorBlockStmtAltContext,
  ConfigSelectorContext,
  ConfigStatementContext,
  InvalidStatementContext,
} from "../../generated/ConfigParser.ts";
import type {
  ArgumentListContext,
  ExpressionContext,
  IdentifierContext,
  StatementContext,
} from "../../generated/ScriptParser.ts";
import { has } from "../build/alt.ts";
import { type BuildContext, FatalBuildError } from "../build/context.ts";
import { argumentList, expression } from "../build/expressions.ts";
import { stringValue } from "../build/literals.ts";
import { statement } from "../build/statements.ts";
import { identifier } from "../build/types.ts";

// The config parse tree's expression contexts have the shapes the script builders read (see build/expressions.ts).
const expr = (ctx: unknown, cx: BuildContext) =>
  expression(ctx as ExpressionContext, cx);

function configName(ctx: ConfigPrimaryContext, cx: BuildContext): ConfigName {
  const string = ctx.stringLiteral();
  return {
    kind: "ConfigName",
    // upstream's `configPrimary` decodes the name without checking its escapes
    name: string ? stringValue(string.getText()) : ctx.getText(),
    form: string ? "string" : ctx.identifier() ? "identifier" : "builtInType",
    range: cx.range(ctx),
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
    name: identifier(ctx.identifier() as unknown as IdentifierContext, cx),
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

const INVALID = {
  ifElseStatement: "If statements cannot be mixed with config statements",
  tryCatchStatement: "Try-catch blocks cannot be mixed with config statements",
  variableDeclaration:
    "Variable declarations cannot be mixed with config statements",
} as const;
const INVALID_ACCESSORS = Object.keys(INVALID) as (keyof typeof INVALID)[];

/**
 * An if, try or `def`: reported, and kept (upstream drops it). Upstream's `invalidStatement` reports only its one message
 * and never builds the statement, so nothing inside it is checked: the kept statement is built, then the errors and the
 * held number-format error that building collected are taken back. A fatal error inside leaves no statement.
 */
function configInvalid(
  ctx: InvalidStatementContext,
  cx: BuildContext,
): ConfigInvalid {
  const range = cx.range(ctx);
  const accessor =
    INVALID_ACCESSORS.find((a) => ctx[a]()) ?? "variableDeclaration";
  cx.error(INVALID[accessor], range);
  // `statement` tells the alternatives apart by the accessors a context has; `invalidStatement` has all three, so hand it
  // a view with only the one that matched.
  const view = {
    start: ctx.start,
    stop: ctx.stop,
    [accessor]: () => ctx[accessor](),
  };
  const errorCount = cx.errors.length;
  const held = cx.numberFormatError;
  try {
    return {
      kind: "ConfigInvalid",
      statement: statement(
        view as unknown as StatementContext,
        cx,
      ) as ConfigInvalid["statement"],
      range,
    };
  } catch (error) {
    if (!(error instanceof FatalBuildError)) throw error;
    return { kind: "ConfigInvalid", range };
  } finally {
    cx.errors.length = errorCount;
    cx.numberFormatError = held;
  }
}

function configBlock(ctx: ConfigBlockContext, cx: BuildContext): ConfigBlock {
  return {
    kind: "ConfigBlock",
    name: configName(ctx.configPrimary(), cx),
    statements: ctx.configBlockStatement().map((s) => configStatement(s, cx)),
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
    statements: ctx.configBlockStatement().map((s) => configStatement(s, cx)),
    range: cx.range(ctx),
  };
}

/** A statement at the top or in a block: the two rules have the same alternatives, and only a block has selectors. */
function configStatement(
  ctx: ConfigStatementContext | ConfigBlockStatementContext,
  cx: BuildContext,
): ConfigStatement {
  if (has<ConfigIncludeStmtAltContext>(ctx, "configInclude"))
    return configInclude(ctx.configInclude(), cx);
  if (has<ConfigApplyBlockStmtAltContext>(ctx, "configApplyBlock"))
    return configApplyBlock(ctx.configApplyBlock(), cx);
  if (has<ConfigAssignStmtAltContext>(ctx, "configAssign"))
    return configAssign(ctx.configAssign(), cx);
  if (has<ConfigBlockStmtAltContext>(ctx, "configBlock"))
    return configBlock(ctx.configBlock(), cx);
  if (has<ConfigSelectorBlockStmtAltContext>(ctx, "configSelector"))
    return configSelector(ctx.configSelector(), cx);
  if (has<ConfigIncompleteStmtAltContext>(ctx, "configIncomplete"))
    return configIncomplete(ctx.configIncomplete(), cx);
  if (has<ConfigInvalidStmtAltContext>(ctx, "invalidStatement"))
    return configInvalid(ctx.invalidStatement(), cx);
  return cx.fatal(`Invalid statement: ${ctx.getText()}`, cx.range(ctx));
}

/** The config root: its statements in source order. The comment list is filled by `parseConfigAst`. */
export function buildConfig(
  tree: CompilationUnitContext,
  cx: BuildContext,
): ConfigAst {
  const statements = tree.configStatement().map((s) => configStatement(s, cx));
  // upstream fails the build with the last number-format error, after everything else
  cx.failOnNumberFormat();
  return {
    kind: "ConfigFile",
    statements,
    comments: [],
    range: cx.index.range(0, cx.index.size),
  };
}
