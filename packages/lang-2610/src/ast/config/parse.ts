// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/config/parser/ConfigAstBuilder.java
// `buildAST` (Apache-2.0; see ../../../grammar/NOTICE). Not exported from the pack entry: the parser and the builders reach
// the engine through a worker (ADR 0027).
import type { ConfigParseResult, ParseProblem } from "@nf-builder/lang-core";
import { parseConfig } from "../../parser/parse.ts";
import { attachConfigComments } from "../attach-comments.ts";
import { BuildContext, FatalBuildError } from "../build/context.ts";
import { collectComments } from "../comments.ts";
import { buildConfig } from "./build.ts";

const byPosition = (a: ParseProblem, b: ParseProblem) =>
  a.line - b.line || a.column - b.column;

/**
 * Parse `text` and build the config AST. `ok: false` when the lexer, the parser or a fatal builder error stops the
 * build; otherwise the AST and the errors the builder collected, sorted by position.
 */
export function parseConfigAst(text: string): ConfigParseResult {
  const outcome = parseConfig(text);
  if (!outcome.ok) return { ok: false, errors: [outcome.error] };
  const cx = new BuildContext(text, outcome.tokens);
  try {
    const config = buildConfig(outcome.tree, cx);
    // upstream fails the build with the last number-format error, after everything else
    cx.failOnNumberFormat();
    outcome.tokens.fill();
    const { comments } = collectComments(outcome.tokens.getTokens(), cx.index);
    const ast = { ...config, comments };
    attachConfigComments(ast, comments);
    return { ok: true, ast, errors: cx.errors.sort(byPosition) };
  } catch (error) {
    if (!(error instanceof FatalBuildError)) throw error;
    return {
      ok: false,
      errors: [...cx.errors, error.problem].sort(byPosition),
    };
  }
}
