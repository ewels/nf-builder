// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/config/parser/ConfigAstBuilder.java
// `buildAST` (Apache-2.0; see ../../../grammar/NOTICE). Not exported from the pack entry: the parser and the builders reach
// the engine through a worker (ADR 0027).
import type { ConfigParseResult, ParseProblem } from "@nf-builder/lang-core";
import { parseConfig } from "../../parser/parse.ts";
import { BuildContext, FatalBuildError } from "../build/context.ts";
import { collectComments } from "../comments.ts";
import { buildConfig } from "./build.ts";
import { literalErrors } from "./literal-errors.ts";

const byPosition = (a: ParseProblem, b: ParseProblem) =>
  a.line - b.line || a.column - b.column;
const endsBefore = (a: ParseProblem, fatal: ParseProblem) =>
  a.line < fatal.endLine ||
  (a.line === fatal.endLine && a.column <= fatal.endColumn);

/**
 * Parse `text` and build the config AST. `ok: false` when the lexer, the parser or a fatal builder error stops the
 * build; otherwise the AST and the errors the builder collected, sorted by position.
 *
 * TODO(F-103 follow-up): comments are collected into `ast.comments` only; the slots (leading, trailing, dangling) are
 * filled by F-102's port of nf-lang's `CommentAttacher` once that has merged and is reused for config nodes.
 */
export function parseConfigAst(text: string): ConfigParseResult {
  const outcome = parseConfig(text);
  if (!outcome.ok) return { ok: false, errors: [outcome.error] };
  const cx = new BuildContext(text, outcome.tokens);
  const literals = literalErrors(outcome.tree, cx);
  try {
    const config = buildConfig(outcome.tree, cx);
    outcome.tokens.fill();
    const { comments } = collectComments(outcome.tokens.getTokens(), cx.index);
    return {
      ok: true,
      ast: { ...config, comments },
      // a number-format error is held to the end, as upstream
      errors: [
        ...cx.errors,
        ...literals.escapes,
        ...(literals.number ? [literals.number] : []),
      ].sort(byPosition),
    };
  } catch (error) {
    if (!(error instanceof FatalBuildError)) throw error;
    // upstream collects nothing after the fatal error; the escapes before it were already collected
    return {
      ok: false,
      errors: [
        ...cx.errors,
        ...literals.escapes.filter((e) => endsBefore(e, error.problem)),
        error.problem,
      ].sort(byPosition),
    };
  }
}
