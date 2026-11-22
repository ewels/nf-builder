// Parses a script or config the way nf-lang's ScriptAstBuilder.buildCST does: SLL first with a bail-out strategy and no
// listeners, then, if that fails with a parser error, LL with a listener that records the first error. One syntax error per file.
import {
  type ATN,
  BailErrorStrategy,
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
  type RecognitionException,
  type Recognizer,
  type Token,
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

export type ParseError = {
  source: "lexer" | "parser";
  message: string;
  line: number;
  column: number;
};
export type ParseOutcome<T> =
  | { ok: true; tree: T; mode: "SLL" | "LL" }
  | { ok: false; error: ParseError; mode: "SLL" | "LL" };

type AnyParser = ScriptParser | ConfigParser;

class FirstErrorListener extends BaseErrorListener {
  first: ParseError | undefined;

  override syntaxError(
    _recognizer: Recognizer<never>,
    _offendingSymbol: unknown,
    line: number,
    charPositionInLine: number,
    message: string,
  ): void {
    this.first ??= {
      source: "parser",
      message,
      line,
      column: charPositionInLine + 1,
    };
  }
}

/**
 * Stage 1 is SLL, except for the decisions inside rules `sep` and `type`, which are predicted with LL. SLL cannot see the
 * caller of `sep : (NL | SEMI)+` (a blank line before `emit:`), nor tell `x instanceof List ? a : b` from a nullable type,
 * so it fails and drops to full LL for most real files (sarek: about 50 s instead of about 1 s). Upstream's two-stage
 * parse falls back on the same files. Stage 2 stays pure LL, and the trees are identical (checked on the corpus).
 */
class Stage1Simulator extends ParserATNSimulator {
  constructor(
    parser: Parser,
    atn: ATN,
    dfa: DFA[],
    private readonly ll: ReadonlySet<number>,
  ) {
    super(parser, atn, dfa, new PredictionContextCache());
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

const isCancellation = (error: unknown): error is ParseCancellationException =>
  error instanceof ParseCancellationException;

/** The error behind a bail-out: the listener's if it heard one, else the recognition exception's offending token. */
function errorOf(
  error: ParseCancellationException,
  listener: FirstErrorListener,
): ParseError {
  if (listener.first) return listener.first;
  const cause = (error as { cause?: unknown }).cause as
    | RecognitionException
    | undefined;
  const token: Token | null | undefined = cause?.offendingToken;
  return {
    source: "parser",
    message: cause?.message ?? error.message,
    line: token?.line ?? 1,
    column: (token?.column ?? 0) + 1,
  };
}

function run<T>(
  text: string,
  makeLexer: (input: CharStream) => ScriptLexer | ConfigLexer,
  makeParser: (tokens: CommonTokenStream) => AnyParser,
  start: (parser: AnyParser) => T,
): ParseOutcome<T> {
  const lexer = makeLexer(CharStream.fromString(text));
  lexer.removeErrorListeners();
  const tokens = new CommonTokenStream(lexer);
  const parser = makeParser(tokens);
  parser.removeErrorListeners();
  parser.errorHandler = new BailErrorStrategy();
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
      },
    }) as const;

  try {
    return { ok: true, tree: start(parser), mode: "SLL" };
  } catch (error) {
    if (error instanceof LexerSyntaxError) return lexerError(error, "SLL");
    if (!isCancellation(error)) throw error;
  }

  tokens.seek(0);
  parser.reset();
  const listener = new FirstErrorListener();
  parser.addErrorListener(listener);
  parser.interpreter = base;
  base.predictionMode = PredictionMode.LL;
  try {
    return { ok: true, tree: start(parser), mode: "LL" };
  } catch (error) {
    if (error instanceof LexerSyntaxError) return lexerError(error, "LL");
    if (!isCancellation(error)) throw error;
    return { ok: false, mode: "LL", error: errorOf(error, listener) };
  }
}

export function parseScript(
  text: string,
): ParseOutcome<CompilationUnitContext> {
  return run(
    text,
    (input) => new ScriptLexer(input),
    (tokens) => new ScriptParser(tokens),
    (parser) => (parser as ScriptParser).compilationUnit(),
  );
}

export function parseConfig(text: string): ParseOutcome<ConfigUnitContext> {
  return run(
    text,
    (input) => new ConfigLexer(input),
    (tokens) => new ConfigParser(tokens),
    (parser) => (parser as ConfigParser).compilationUnit(),
  );
}
