// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `scriptDeclaration` and the declarations it dispatches to (Apache-2.0; see ../../../grammar/NOTICE).
import type {
  Block,
  Declaration,
  EnumDef,
  Expression,
  FeatureFlag,
  FunctionDef,
  Identifier,
  ImportDeclaration,
  Include,
  IncludeEntry,
  IncompleteDeclaration,
  LegacyParam,
  OutputBlock,
  OutputDecl,
  Param,
  ParamsBlock,
  RecordDef,
} from "@nf-builder/lang-core";
import type { ParserRuleContext, TerminalNode } from "antlr4ng";
import type {
  EnumDefContext,
  FeatureFlagDeclarationContext,
  FeatureFlagNameContext,
  FunctionDefContext,
  ImportDeclarationContext,
  IncludeDeclarationContext,
  IncludeNameContext,
  IncompleteScriptDeclarationContext,
  OutputDeclarationContext,
  OutputDefContext,
  ParamDeclarationContext,
  ParamDeclarationV1Context,
  ParamsDefContext,
  RecordDefContext,
  StatementContext,
} from "../../generated/ScriptParser.ts";
import {
  AgentDefAltContext,
  EnumDefAltContext,
  FeatureFlagDeclAltContext,
  FunctionDefAltContext,
  ImportDeclAltContext,
  IncludeDeclAltContext,
  IncompleteScriptDeclAltContext,
  OutputDefAltContext,
  ParamDeclV1AltContext,
  ParamsDefAltContext,
  ProcessDefAltContext,
  RecordDefAltContext,
  type ScriptDeclarationContext,
  WorkflowDefAltContext,
} from "../../generated/ScriptParser.ts";
import { spanRanges, tokenRange } from "../positions.ts";
import type { BuildContext } from "./context.ts";
import { expression } from "./expressions.ts";
import { stringLiteral } from "./literals.ts";
import { agentDef, processDef } from "./process.ts";
import { unparen } from "./sections.ts";
import { blockStatements, statement } from "./statements.ts";
import {
  checkVariableName,
  identifier,
  legacyType,
  parameter,
  typedName,
  typeRef,
} from "./types.ts";
import { workflowDef } from "./workflow.ts";

/** Build one declaration, or `null` when upstream drops it (a legacy parameter with types enabled). */
export function scriptDeclaration(
  ctx: ScriptDeclarationContext,
  cx: BuildContext,
): Declaration | null {
  if (ctx instanceof FeatureFlagDeclAltContext)
    return featureFlag(ctx.featureFlagDeclaration(), cx);
  if (ctx instanceof IncludeDeclAltContext)
    return include(ctx.includeDeclaration(), cx);
  if (ctx instanceof ImportDeclAltContext)
    return importDeclaration(ctx.importDeclaration(), cx);
  if (ctx instanceof ParamsDefAltContext)
    return paramsBlock(ctx.paramsDef(), cx);
  if (ctx instanceof ParamDeclV1AltContext)
    return legacyParam(ctx.paramDeclarationV1(), cx);
  if (ctx instanceof RecordDefAltContext) return recordDef(ctx.recordDef(), cx);
  if (ctx instanceof EnumDefAltContext) return enumDef(ctx.enumDef(), cx);
  if (ctx instanceof AgentDefAltContext) return agentDef(ctx.agentDef(), cx);
  if (ctx instanceof ProcessDefAltContext)
    return processDef(ctx.processDef(), cx);
  if (ctx instanceof WorkflowDefAltContext)
    return workflowDef(ctx.workflowDef(), cx);
  if (ctx instanceof OutputDefAltContext)
    return outputBlock(ctx.outputDef(), cx);
  if (ctx instanceof FunctionDefAltContext)
    return functionDef(ctx.functionDef(), cx);
  if (ctx instanceof IncompleteScriptDeclAltContext)
    return incompleteDeclaration(ctx.incompleteScriptDeclaration(), cx);
  throw new Error(`Invalid script declaration: ${ctx.getText()}`);
}

/** The dotted name, e.g. `nextflow.enable.types`, as one identifier. */
export function featureFlagName(
  ctx: FeatureFlagNameContext,
  cx: BuildContext,
): Identifier {
  return { kind: "Identifier", name: ctx.getText(), range: cx.range(ctx) };
}

export function featureFlag(
  ctx: FeatureFlagDeclarationContext,
  cx: BuildContext,
): FeatureFlag {
  const name = featureFlagName(ctx.featureFlagName(), cx);
  const value = expression(ctx.expression(), cx);
  const range = cx.range(ctx);
  // `nextflow.enable.types = true` turns typing on for everything after it, and nothing turns it off
  if (name.name === "nextflow.enable.types" && isTrue(value))
    cx.typesEnabled = true;
  // upstream: the value must be a constant (parentheses are looked through; `-1` and a gstring are not constants)
  if (!isConstant(value))
    cx.error(
      "Feature flag value must be a literal value (number, string, true/false)",
      range,
    );
  return { kind: "FeatureFlag", name, value, range };
}

const isTrue = (value: Expression) =>
  value.kind === "Boolean" && value.value === true;

function isConstant(value: Expression): boolean {
  const e = value.kind === "Parenthesized" ? unparen(value) : value;
  return (
    e.kind === "Number" ||
    e.kind === "String" ||
    e.kind === "Boolean" ||
    e.kind === "Null"
  );
}

export function include(
  ctx: IncludeDeclarationContext,
  cx: BuildContext,
): Include {
  return {
    kind: "Include",
    entries: ctx
      .includeNames()
      .includeName()
      .map((e) => includeEntry(e, cx)),
    source: stringLiteral(ctx.stringLiteral(), cx),
    range: cx.range(ctx),
  };
}

export function includeEntry(
  ctx: IncludeNameContext,
  cx: BuildContext,
): IncludeEntry {
  const alias = ctx._alias;
  return {
    kind: "IncludeEntry",
    name: identifier(ctx._name as never, cx),
    alias: alias ? identifier(alias, cx) : null,
    range: cx.range(ctx),
  };
}

function importDeclaration(
  ctx: ImportDeclarationContext,
  cx: BuildContext,
): ImportDeclaration {
  const range = cx.range(ctx);
  cx.error(
    "Groovy `import` declarations are not supported -- use fully-qualified name inline instead",
    range,
  );
  return { kind: "Import", name: ctx.qualifiedClassName().getText(), range };
}

export function paramsBlock(
  ctx: ParamsDefContext,
  cx: BuildContext,
): ParamsBlock {
  const params: Param[] = [];
  for (const p of ctx.paramsBody()?.paramDeclaration() ?? []) {
    const item = param(p, cx);
    if (item) params.push(item);
  }
  return { kind: "ParamsBlock", params, range: cx.range(ctx) };
}

/** A parameter of the `params` block; a statement in its place is dropped. */
export function param(
  ctx: ParamDeclarationContext,
  cx: BuildContext,
): Param | null {
  const ident = ctx.identifier();
  if (!ident) {
    // upstream reports the statement without building it
    const stmt = ctx.statement();
    cx.error(
      "Invalid parameter declaration",
      cx.range(stmt as ParserRuleContext),
    );
    return null;
  }
  const type = ctx.type();
  const value = ctx.expression();
  const node: Param = {
    kind: "Param",
    name: identifier(ident, cx),
    type: type ? typeRef(type, cx) : null,
    defaultValue: value ? expression(value, cx) : null,
    range: cx.range(ctx),
  };
  checkVariableName(node.name.name, node.range, cx);
  return node;
}

/** `params.a.b = value`; dropped when types are enabled (use the `params` block). */
export function legacyParam(
  ctx: ParamDeclarationV1Context,
  cx: BuildContext,
): LegacyParam | null {
  if (cx.typesEnabled) {
    cx.error(
      "Legacy parameter is not allowed with `nextflow.enable.types = true` -- use the `params` block instead",
      cx.range(ctx),
    );
    return null;
  }
  let target: Expression = {
    kind: "Variable",
    name: "params",
    range: cx.tokenRange(ctx.PARAMS().symbol),
  };
  for (const ident of ctx.identifier()) {
    const property = identifier(ident, cx);
    target = {
      kind: "Property",
      object: target,
      navigation: ".",
      property,
      range: spanRanges(target.range, property.range),
    };
  }
  return {
    kind: "LegacyParam",
    target: target as LegacyParam["target"],
    value: expression(ctx.expression(), cx),
    range: cx.range(ctx),
  };
}

export function recordDef(ctx: RecordDefContext, cx: BuildContext): RecordDef {
  const range = cx.range(ctx);
  const body = ctx.recordBody();
  if (!body) cx.error("Missing record body", range);
  return {
    kind: "Record",
    name: identifier(ctx.identifier(), cx),
    fields: (body?.nameTypePair() ?? []).map((p) => {
      const field = typedName(p, cx);
      if (!p.type()) cx.error("Missing field type", field.range);
      return field;
    }),
    range,
  };
}

export function enumDef(ctx: EnumDefContext, cx: BuildContext): EnumDef {
  return {
    kind: "Enum",
    name: identifier(ctx.identifier(), cx),
    constants: (ctx.enumBody()?.identifier() ?? []).map((i) =>
      identifier(i, cx),
    ),
    trailingComma: ctx.COMMA() !== null,
    range: cx.range(ctx),
  };
}

export function outputBlock(
  ctx: OutputDefContext,
  cx: BuildContext,
): OutputBlock {
  const outputs: OutputDecl[] = [];
  for (const o of ctx.outputBody()?.outputDeclaration() ?? []) {
    const item = outputDecl(o, cx);
    if (item) outputs.push(item);
  }
  return { kind: "OutputBlock", outputs, range: cx.range(ctx) };
}

/** An output of the `output` block; a statement in its place is dropped. */
export function outputDecl(
  ctx: OutputDeclarationContext,
  cx: BuildContext,
): OutputDecl | null {
  const ident = ctx.identifier();
  if (!ident) {
    // built first, so that its own errors are reported too
    const stmt = statement(ctx.statement() as StatementContext, cx);
    cx.error("Invalid output declaration", stmt.range);
    return null;
  }
  const type = ctx.type();
  const node: OutputDecl = {
    kind: "Output",
    name: identifier(ident, cx),
    type: type ? typeRef(type, cx) : null,
    body: braces(ctx.blockStatements(), ctx, cx),
    range: cx.range(ctx),
  };
  checkVariableName(node.name.name, node.range, cx);
  return node;
}

/** The `{ ... }` of a declaration as a block that includes the braces. */
function braces(
  statements: Parameters<typeof blockStatements>[0],
  ctx: { LBRACE(): TerminalNode | null; RBRACE(): TerminalNode | null },
  cx: BuildContext,
): Block {
  const open = ctx.LBRACE() as TerminalNode;
  const close = ctx.RBRACE() as TerminalNode;
  return {
    kind: "Block",
    statements: blockStatements(statements, cx),
    range: tokenRange(open.symbol, close.symbol, cx.index),
  };
}

export function functionDef(
  ctx: FunctionDefContext,
  cx: BuildContext,
): FunctionDef {
  const legacy = ctx.legacyType();
  const returnType = ctx.type();
  // Fields are created in source order: `def String name(params) -> Type { ... }`.
  const node: FunctionDef = {
    kind: "Function",
    def: ctx.DEF() !== null,
    legacyReturnType: legacy ? legacyType(legacy, cx) : null,
    name: identifier(ctx.identifier(), cx),
    params: (ctx.formalParameterList()?.formalParameter() ?? []).map((p) =>
      parameter(p, cx),
    ),
    returnType: returnType ? typeRef(returnType, cx) : null,
    body: braces(ctx.blockStatements(), ctx, cx),
    range: cx.range(ctx),
  };
  checkVariableName(node.name.name, node.range, cx);
  return node;
}

function incompleteDeclaration(
  ctx: IncompleteScriptDeclarationContext,
  cx: BuildContext,
): IncompleteDeclaration {
  const range = cx.range(ctx);
  cx.error("Incomplete declaration", range);
  return { kind: "IncompleteDeclaration", text: ctx.getText(), range };
}
