// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `compilationUnit` (Apache-2.0; see ../../../grammar/NOTICE).
import type { ScriptAst, ScriptItem } from "@nf-builder/lang-core";
import type { CompilationUnitContext } from "../../generated/ScriptParser.ts";
import type { BuildContext } from "./context.ts";
import { statement } from "./statements.ts";

/**
 * The script root: its declarations and top-level statements in source order. The comment fields are filled by
 * `parseScriptAst`.
 */
export function buildScript(
  tree: CompilationUnitContext,
  cx: BuildContext,
): ScriptAst {
  const body: ScriptItem[] = [];
  for (const item of tree.scriptDeclarationOrStatement()) {
    const stmt = item.statement();
    if (stmt) body.push(statement(stmt, cx));
    else throw new Error("Script declarations are built by F-102 task 3");
  }
  return {
    kind: "Script",
    shebang: null,
    body,
    comments: [],
    typesEnabled: cx.typesEnabled,
    range: cx.index.range(0, cx.index.size),
  };
}
