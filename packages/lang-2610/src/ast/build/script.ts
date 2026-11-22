// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `compilationUnit` and `scriptDeclaration` (Apache-2.0; see ../../../grammar/NOTICE).
import type {
  ParamsBlock,
  ScriptAst,
  ScriptItem,
  Statement,
} from "@nf-builder/lang-core";
import type {
  CompilationUnitContext,
  ScriptDeclarationContext,
  StatementContext,
} from "../../generated/ScriptParser.ts";
import { reparseDeclaration } from "../reparse.ts";
import type { BuildContext } from "./context.ts";
import { scriptDeclaration } from "./declarations.ts";
import { unparen } from "./sections.ts";
import { statement } from "./statements.ts";

const SCRIPT_DEF_NAMES = ["agent", "process", "workflow", "output"] as const;

/** The name of the call a statement is, as Groovy's `getMethodAsString` says it (the receiver is ignored). */
function calledName(stmt: Statement): string | null {
  if (stmt.kind !== "ExpressionStatement") return null;
  const e = unparen(stmt.expression);
  if (e.kind !== "MethodCall") return null;
  return e.method.kind === "String" ? e.method.value : e.method.name;
}

/**
 * The script root: its declarations and top-level statements in source order, with the errors of the whole script
 * (duplicate blocks, statements mixed with declarations, declarations that failed to parse). The comment fields are
 * filled by `parseScriptAst`.
 */
export function buildScript(
  tree: CompilationUnitContext,
  cx: BuildContext,
): ScriptAst {
  const body: ScriptItem[] = [];
  const topStatements: { index: number; ctx: StatementContext }[] = [];
  let hasDeclarations = false;
  // what the script has so far, for the checks upstream makes against its module node
  let params: ParamsBlock | null = null;
  let outputs: ScriptItem | null = null;
  let entry = false;
  let legacyParams = 0;

  for (const item of tree.scriptDeclarationOrStatement()) {
    const stmt = item.statement();
    if (stmt) {
      topStatements.push({ index: body.length, ctx: stmt });
      body.push(statement(stmt, cx));
      continue;
    }
    const node = scriptDeclaration(
      item.scriptDeclaration() as ScriptDeclarationContext,
      cx,
    );
    // an import and an incomplete declaration do not make the script one of declarations
    if (
      !node ||
      (node.kind !== "Import" && node.kind !== "IncompleteDeclaration")
    )
      hasDeclarations = true;
    if (!node) {
      legacyParams++; // a legacy parameter dropped because types are enabled
      continue;
    }
    body.push(node);
    switch (node.kind) {
      case "OutputBlock":
        if (outputs)
          cx.error("Output block defined more than once", node.range);
        outputs = node;
        break;
      case "ParamsBlock":
        if (params) cx.error("Params block defined more than once", node.range);
        if (legacyParams > 0)
          cx.error(
            "Params block cannot be mixed with legacy parameter declarations",
            node.range,
          );
        params = node;
        break;
      case "LegacyParam":
        if (params)
          cx.error(
            "Legacy parameter declarations cannot be mixed with the params block",
            node.range,
          );
        legacyParams++;
        break;
      case "Workflow":
        if (node.name === null) {
          if (entry)
            cx.error("Entry workflow defined more than once", node.range);
          entry = true;
        }
        break;
    }
  }

  // a top-level call named like a declaration is one that failed to parse as such
  const statements: Statement[] = [];
  for (const { index, ctx } of topStatements) {
    const stmt = body[index] as Statement;
    const name = calledName(stmt);
    const keyword = SCRIPT_DEF_NAMES.find((n) => n === name);
    if (!keyword) {
      statements.push(stmt);
      continue;
    }
    const { rejected, error } = reparseDeclaration(ctx, cx.tokens);
    if (error) cx.errors.push(error);
    else if (!rejected)
      cx.error(
        `Invalid ${keyword} definition -- check for missing or out-of-order section labels`,
        stmt.range,
      );
    body[index] = {
      kind: "InvalidDeclaration",
      keyword,
      statement: stmt,
      range: stmt.range,
    };
    hasDeclarations = true;
  }

  if (hasDeclarations)
    for (const item of statements)
      cx.error(
        "Statements cannot be mixed with script declarations -- move statements into a process, workflow, or function",
        item.range,
      );

  if (!entry && params)
    cx.error(
      "Params block cannot be defined without an entry workflow",
      params.range,
    );
  if (!entry && outputs)
    cx.error(
      "Output block cannot be defined without an entry workflow",
      outputs.range,
    );

  // upstream fails the build with the last number-format error, after everything else
  cx.failOnNumberFormat();

  return {
    kind: "Script",
    shebang: null,
    body,
    comments: [],
    typesEnabled: cx.typesEnabled,
    range: cx.index.range(0, cx.index.size),
  };
}
