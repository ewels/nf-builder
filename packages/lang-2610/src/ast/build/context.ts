// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `collectSyntaxError` and `createParsingFailedException` (Apache-2.0; see ../../../grammar/NOTICE).
import type { ParseProblem, Range } from "@nf-builder/lang-core";
import type { CommonTokenStream, ParserRuleContext, Token } from "antlr4ng";
import { contextRange, PositionIndex, tokenRange } from "../positions.ts";

/** `ParseProblem.code` of an error about a definition in the other style, typed or legacy (LA-13, F-111). */
export const MIXED_DEFINITIONS = "mixed-definitions";

/** A builder error that stops the build (upstream `createParsingFailedException`): the file gets no tree. */
export class FatalBuildError extends Error {
  readonly problem: ParseProblem;

  constructor(problem: ParseProblem) {
    super(problem.message);
    this.name = "FatalBuildError";
    this.problem = problem;
  }
}

/** How a build differs from a whole-file one (F-104: a chunk of a file is built as a fragment). */
export interface ScriptBuildOptions {
  /** Types were enabled by an earlier chunk. */
  readonly typesEnabled?: boolean;
  /** Skip the whole-script checks, which depend on the other chunks. */
  readonly fragment?: boolean;
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

  private readonly fragment: boolean;

  constructor(
    text: string,
    tokens: CommonTokenStream,
    options: ScriptBuildOptions = {},
  ) {
    this.index = new PositionIndex(text);
    this.tokens = tokens;
    this.typesEnabled = options.typesEnabled ?? false;
    this.fragment = options.fragment ?? false;
  }

  range(ctx: ParserRuleContext): Range {
    return contextRange(ctx, this.tokens, this.index);
  }

  tokenRange(token: Token): Range {
    return tokenRange(token, token, this.index);
  }

  /** Collect an error and carry on (upstream `collectSyntaxError`). */
  error(message: string, at: Range, code?: string): void {
    this.errors.push(
      code ? { ...problem(message, at), code } : problem(message, at),
    );
  }

  /**
   * Collect an error about the whole script, not the node it is reported at (a duplicate params block, statements mixed
   * with declarations): F-104 never isolates a declaration for it. Nothing in a fragment, which does not see the rest.
   */
  fileError(message: string, at: Range): void {
    if (this.fragment) return;
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
