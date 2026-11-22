// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `reparseScriptDeclaration` (Apache-2.0; see ../../grammar/NOTICE).
import {
  type CommonTokenStream,
  ParseCancellationException,
  type ParserATNSimulator,
  PredictionMode,
} from "antlr4ng";
import type { StatementContext } from "../generated/ScriptParser.ts";
import { ScriptParser } from "../generated/ScriptParser.ts";
import { DescriptiveErrorStrategy } from "../parser/descriptive-error-strategy.ts";
import { FirstErrorListener, type ParseError } from "../parser/parse.ts";

/**
 * Parse the statement again from its first token as a script declaration, in full LL mode, to find the syntax error
 * that made it a statement, e.g. `process foo { ... }` with an invalid body. `null` when it parses: the statement is a
 * well-formed call whose sections are missing or out of order. Like upstream, a failed parse that reported nothing still
 * counts as rejected.
 */
export function reparseDeclaration(
  at: StatementContext,
  tokens: CommonTokenStream,
): { rejected: boolean; error: ParseError | null } {
  const parser = new ScriptParser(tokens);
  parser.errorHandler = new DescriptiveErrorStrategy();
  (parser.interpreter as ParserATNSimulator).predictionMode = PredictionMode.LL;
  parser.removeErrorListeners();
  const listener = new FirstErrorListener();
  parser.addErrorListener(listener);
  tokens.seek((at.start as { tokenIndex: number }).tokenIndex);
  try {
    parser.scriptDeclaration();
    return { rejected: false, error: null };
  } catch (error) {
    if (!(error instanceof ParseCancellationException)) throw error;
    return { rejected: true, error: listener.first ?? null };
  }
}
