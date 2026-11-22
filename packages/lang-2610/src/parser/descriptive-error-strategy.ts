// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/DescriptiveErrorStrategy.java
// (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE). The unused CharStream constructor argument is dropped.
import {
  BailErrorStrategy,
  FailedPredicateException,
  InputMismatchException,
  NoViableAltException,
  ParseCancellationException,
  type Parser,
  PredictionMode,
  type RecognitionException,
  Token,
} from "antlr4ng";

export const EOF_ERROR_MESSAGE =
  "Unexpected end of file -- check for an unclosed brace, bracket, parenthesis, or string";

/** Bail out at the first error; in LL mode, report it first with Nextflow's wording. */
export class DescriptiveErrorStrategy extends BailErrorStrategy {
  override recover(recognizer: Parser, e: RecognitionException): never {
    // Upstream also sets `exception` on every context up the chain; antlr4ng's ParserRuleContext has no such field, and the tree is discarded on error.
    if (recognizer.interpreter.predictionMode === PredictionMode.LL) {
      if (e instanceof NoViableAltException)
        this.reportNoViableAlternative(recognizer, e);
      else if (e instanceof InputMismatchException)
        this.reportInputMismatch(recognizer, e);
      else if (e instanceof FailedPredicateException)
        this.reportFailedPredicate(recognizer, e);
    }
    throw new ParseCancellationException(e);
  }

  override recoverInline(recognizer: Parser): never {
    return this.recover(recognizer, new InputMismatchException(recognizer));
  }

  override reportError(): void {}

  override reportNoViableAlternative(
    recognizer: Parser,
    e: NoViableAltException,
  ): void {
    const token = e.offendingToken;
    const message =
      token?.type === Token.EOF
        ? EOF_ERROR_MESSAGE
        : `Unexpected input: ${this.escapeWSAndQuote(token?.text ?? "<unknown input>")}`;
    recognizer.notifyErrorListeners(message, token, e);
  }

  override reportInputMismatch(
    recognizer: Parser,
    e: RecognitionException,
  ): void {
    const token = e.offendingToken;
    const message =
      token?.type === Token.EOF
        ? EOF_ERROR_MESSAGE
        : `Unexpected input: ${this.getTokenErrorDisplay(token)}`;
    recognizer.notifyErrorListeners(message, token, e);
  }

  // The message embeds the predicate's source text: TypeScript here, Java upstream. No known input reaches it.
  override reportFailedPredicate(
    recognizer: Parser,
    e: RecognitionException,
  ): void {
    recognizer.notifyErrorListeners(e.message, e.offendingToken, e);
  }
}
