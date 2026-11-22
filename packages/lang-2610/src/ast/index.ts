// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `buildAST` (Apache-2.0; see ../../grammar/NOTICE). Not exported from the pack entry: the parser and the builders reach
// the engine through a worker (ADR 0027).
import type { ParseProblem, ScriptParseResult } from "@nf-builder/lang-core";
import { parseScript } from "../parser/parse.ts";
import { BuildContext, FatalBuildError } from "./build/context.ts";
import { buildScript } from "./build/script.ts";
import { collectComments } from "./comments.ts";

const byPosition = (a: ParseProblem, b: ParseProblem) =>
  a.line - b.line || a.column - b.column;

/**
 * Parse `text` and build the script AST. `ok: false` when the lexer, the parser or a fatal builder error stops the
 * build; otherwise the AST and the errors the builder collected.
 */
export function parseScriptAst(text: string): ScriptParseResult {
  const outcome = parseScript(text);
  if (!outcome.ok) return { ok: false, errors: [outcome.error] };
  const cx = new BuildContext(text, outcome.tokens);
  try {
    const script = buildScript(outcome.tree, cx);
    outcome.tokens.fill();
    const { shebang, comments } = collectComments(
      outcome.tokens.getTokens(),
      cx.index,
    );
    return {
      ok: true,
      ast: { ...script, shebang, comments },
      errors: cx.errors.sort(byPosition),
    };
  } catch (error) {
    if (!(error instanceof FatalBuildError)) throw error;
    return {
      ok: false,
      errors: [...cx.errors, error.problem].sort(byPosition),
    };
  }
}
export { parseConfigAst } from "./config/parse.ts";
