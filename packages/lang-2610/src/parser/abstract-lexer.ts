// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/AbstractLexer.java and
// the @members of ScriptLexer.g4 / ConfigLexer.g4 (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE),
// with `require` from apache/groovy GROOVY_4_0_33 org.apache.groovy.parser.antlr4.SyntaxErrorReportable and PositionInfo.
import { Lexer, Token } from "antlr4ng";

/** A lexer error raised by `require`: the counterpart of Groovy's `GroovySyntaxError` with source LEXER. */
export class LexerSyntaxError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = "LexerSyntaxError";
    this.line = line;
    this.column = column;
  }
}

export abstract class AbstractLexer extends Lexer {
  /** Never true here: upstream sets it only while Groovy re-lexes for error reporting. */
  protected errorIgnored = false;
  protected tokenIndex = 0;
  protected lastTokenType = 0;
  protected invalidDigitCount = 0;

  /** The token types after which a slash is division, not the start of a slashy string (REGEX_CHECK_ARRAY upstream). */
  protected abstract readonly regexCheckTokenTypes: ReadonlySet<number>;

  /** Records the index and the type of the last default-channel token, as upstream `emit(Token)` does. */
  public override emitToken(token: Token): void {
    this.tokenIndex++;
    if (token.channel === Token.DEFAULT_CHANNEL) {
      this.lastTokenType = token.type;
    }
    super.emitToken(token);
  }

  protected isRegexAllowed(): boolean {
    return !this.regexCheckTokenTypes.has(this.lastTokenType);
  }

  /** `SyntaxErrorReportable.require`: throws unless `condition`; `offset` shifts the column of the reported position. */
  protected require(
    condition: boolean,
    message: string,
    offset: number,
    attachPosition: boolean,
  ): void {
    if (condition) return;
    const line = this.getErrorLine();
    const column = this.getErrorColumn() + offset;
    const position =
      line === -1 || column === -1 ? "" : ` @ line ${line}, column ${column}`;
    throw new LexerSyntaxError(
      message + (attachPosition ? position : ""),
      line,
      column,
    );
  }

  protected getErrorLine(): number {
    return this.line;
  }

  protected getErrorColumn(): number {
    return this.column + 1;
  }
}
