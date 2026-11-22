// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `collectSyntaxError` and `createParsingFailedException` (Apache-2.0; see ../../../grammar/NOTICE).
import type { ParseProblem, Range } from "@nf-builder/lang-core";
import type { CommonTokenStream, ParserRuleContext, Token } from "antlr4ng";
import { contextRange, PositionIndex, tokenRange } from "../positions.ts";

/** A builder error that stops the build (upstream `createParsingFailedException`): the file gets no tree. */
export class FatalBuildError extends Error {
  readonly problem: ParseProblem;

  constructor(problem: ParseProblem) {
    super(problem.message);
    this.name = "FatalBuildError";
    this.problem = problem;
  }
}

/** The state one build shares: the text's positions, the token stream, the collected errors. */
export class BuildContext {
  readonly index: PositionIndex;
  readonly tokens: CommonTokenStream;
  /** `nextflow.enable.types = true` has been seen: processes and workflows built from here on are typed. */
  typesEnabled = false;
  readonly errors: ParseProblem[] = [];
  /**
   * The last number literal that Groovy's `Numbers` rejects (upstream `numberFormatError`). The build fails with it once
   * the whole script is built (`failOnNumberFormat`), so every other error is collected first.
   */
  numberFormatError: { message: string; at: Range } | null = null;

  constructor(text: string, tokens: CommonTokenStream) {
    this.index = new PositionIndex(text);
    this.tokens = tokens;
  }

  range(ctx: ParserRuleContext): Range {
    return contextRange(ctx, this.tokens, this.index);
  }

  tokenRange(token: Token): Range {
    return tokenRange(token, token, this.index);
  }

  /** Collect an error and carry on (upstream `collectSyntaxError`). */
  error(message: string, at: Range): void {
    this.errors.push(problem(message, at));
  }

  /**
   * Collect an error about the whole script, not the node it is reported at (a duplicate params block, statements mixed
   * with declarations): F-104 never isolates a declaration for it.
   */
  fileError(message: string, at: Range): void {
    this.errors.push({ ...problem(message, at), scope: "file" });
  }

  /** Fail the build with the pending number-format error, if there is one. */
  failOnNumberFormat(): void {
    if (this.numberFormatError)
      this.fatal(this.numberFormatError.message, this.numberFormatError.at);
  }

  /** Stop the build (upstream `createParsingFailedException`). */
  fatal(message: string, at: Range): never {
    throw new FatalBuildError(problem(message, at));
  }
}

const problem = (message: string, at: Range): ParseProblem => ({
  source: "builder",
  message,
  line: at.line,
  column: at.column,
  endLine: at.endLine,
  endColumn: at.endColumn,
});
