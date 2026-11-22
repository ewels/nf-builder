// Parses a script or config the way nf-lang's ScriptAstBuilder.buildCST does: SLL first with a bail-out strategy and no
// listeners, then, if that fails with a parser error, LL with a listener that records the first error. One syntax error per file.
import {
  type ATN,
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  type DFA,
  ParseCancellationException,
  type Parser,
  ParserATNSimulator,
  type ParserRuleContext,
  PredictionContextCache,
  PredictionMode,
  type Recognizer,
  Token,
  type TokenStream,
} from "antlr4ng";
import { ConfigLexer } from "../generated/ConfigLexer.ts";
import {
  ConfigParser,
  type CompilationUnitContext as ConfigUnitContext,
} from "../generated/ConfigParser.ts";
import { ScriptLexer } from "../generated/ScriptLexer.ts";
import {
  type CompilationUnitContext,
  ScriptParser,
} from "../generated/ScriptParser.ts";
import { LexerSyntaxError } from "./abstract-lexer.ts";
import { DescriptiveErrorStrategy } from "./descriptive-error-strategy.ts";

export type ParseError = {
  source: "lexer" | "parser";
  message: string;
  line: number;
  column: number;
  endLine: number;
  /** Exclusive. As nf-lang: the start column plus the offending token's length in UTF-16 units (the start is in code points). */
  endColumn: number;
};
export type ParseOutcome<T> =
  | { ok: true; tree: T; mode: "SLL" | "LL"; tokens: CommonTokenStream }
  | { ok: false; error: ParseError; mode: "SLL" | "LL" };

export class FirstErrorListener extends BaseErrorListener {
  first: ParseError | undefined;

  override syntaxError(
    _recognizer: Recognizer<never>,
    offendingSymbol: unknown,
    line: number,
    charPositionInLine: number,
    message: string,
  ): void {
    const token = offendingSymbol as Token | null;
    const column = charPositionInLine + 1;
    this.first ??= {
      source: "parser",
      message,
      line,
      column,
      endLine: line,
      endColumn:
        token && token.type !== Token.EOF && token.text != null
          ? column + token.text.length
          : column + 1,
    };
  }
}

/**
 * Stage 1 is SLL, except for the decisions inside rules `sep` and `type`, which are predicted with LL. SLL cannot see the
 * caller of `sep : (NL | SEMI)+` (a blank line before `emit:`), nor tell `x instanceof List ? a : b` from a nullable type,
 * so it fails and drops to full LL for most real files (sarek: about 50 s instead of about 1 s). Upstream's two-stage
 * parse falls back on the same files. Stage 2 stays pure LL. The corpus test compares the stage 1 tree with the pure LL
 * tree for every file of the small pipelines and a sample of sarek.
 */
class Stage1Simulator extends ParserATNSimulator {
  private readonly ll: ReadonlySet<number>;

  constructor(parser: Parser, atn: ATN, dfa: DFA[], ll: ReadonlySet<number>) {
    super(parser, atn, dfa, new PredictionContextCache());
    this.ll = ll;
  }

  override adaptivePredict(
    input: TokenStream,
    decision: number,
    outerContext: ParserRuleContext | null,
  ): number {
    if (this.predictionMode !== PredictionMode.SLL || !this.ll.has(decision)) {
      return super.adaptivePredict(input, decision, outerContext);
    }
    this.predictionMode = PredictionMode.LL;
    try {
      return super.adaptivePredict(input, decision, outerContext);
    } finally {
      this.predictionMode = PredictionMode.SLL;
    }
  }
}

const llDecisions = (atn: ATN, ruleNames: string[]) => {
  const rules = ["sep", "type"].map((r) => ruleNames.indexOf(r));
  return new Set(
    atn.decisionToState.flatMap((state, d) =>
      rules.includes(state.ruleIndex) ? [d] : [],
    ),
  );
};
const SCRIPT_LL = llDecisions(ScriptParser._ATN, ScriptParser.ruleNames);
const CONFIG_LL = llDecisions(ConfigParser._ATN, ConfigParser.ruleNames);

/** Never happens: in LL mode the strategy reports before it bails out. Fail loudly rather than invent a message. */
function unheard(error: ParseCancellationException): never {
  throw new Error("The parser failed without reporting an error", {
    cause: error,
  });
}

function run<P extends ScriptParser | ConfigParser, T>(
  text: string,
  makeLexer: (input: CharStream) => ScriptLexer | ConfigLexer,
  makeParser: (tokens: CommonTokenStream) => P,
  start: (parser: P) => T,
): ParseOutcome<T> {
  const lexer = makeLexer(CharStream.fromString(text));
  lexer.removeErrorListeners();
  const tokens = new CommonTokenStream(lexer);
  const parser = makeParser(tokens);
  parser.removeErrorListeners();
  parser.errorHandler = new DescriptiveErrorStrategy();
  const base = parser.interpreter as ParserATNSimulator;
  const stage1 = new Stage1Simulator(
    parser,
    parser.atn,
    base.decisionToDFA,
    parser instanceof ScriptParser ? SCRIPT_LL : CONFIG_LL,
  );
  stage1.predictionMode = PredictionMode.SLL;
  parser.interpreter = stage1;

  const lexerError = (error: LexerSyntaxError, mode: "SLL" | "LL") =>
    ({
      ok: false,
      mode,
      error: {
        source: "lexer",
        message: error.message,
        line: error.line,
        column: error.column,
        endLine: error.line,
        endColumn: error.column + 1,
      },
    }) as const;

  try {
    return { ok: true, tree: start(parser), mode: "SLL", tokens };
  } catch (error) {
    if (error instanceof LexerSyntaxError) return lexerError(error, "SLL");
    if (!(error instanceof ParseCancellationException)) throw error;
  }

  tokens.seek(0);
  parser.reset();
  const listener = new FirstErrorListener();
  parser.addErrorListener(listener);
  parser.interpreter = base;
  base.predictionMode = PredictionMode.LL;
  try {
    return { ok: true, tree: start(parser), mode: "LL", tokens };
  } catch (error) {
    if (error instanceof LexerSyntaxError) return lexerError(error, "LL");
    if (!(error instanceof ParseCancellationException)) throw error;
    return { ok: false, mode: "LL", error: listener.first ?? unheard(error) };
  }
}

export function parseScript(
  text: string,
): ParseOutcome<CompilationUnitContext> {
  return run(
    text,
    (input) => new ScriptLexer(input),
    (tokens) => new ScriptParser(tokens),
    (parser) => parser.compilationUnit(),
  );
}

export function parseConfig(text: string): ParseOutcome<ConfigUnitContext> {
  return run(
    text,
    (input) => new ConfigLexer(input),
    (tokens) => new ConfigParser(tokens),
    (parser) => parser.compilationUnit(),
  );
}
