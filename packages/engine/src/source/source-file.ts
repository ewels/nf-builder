import type {
  ConfigSourceParse,
  ParseProblem,
  ScriptSourceParse,
  SourceFile,
  SourceParser,
} from "@nf-builder/lang-core";
import { languageOf } from "./language";
import { verifyModel } from "./verify";

const internal = (message: string): ParseProblem => ({
  source: "internal",
  message,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
});

/**
 * Parses `text` with the pack's parser and wraps the result as a `SourceFile` (AR-01). Never throws (IO-14): a parser
 * that throws, or a model that fails `verifyModel`, leaves the file verbatim with an `internal` problem.
 */
export function createSourceFile(
  path: string,
  text: string,
  parser: SourceParser,
): SourceFile {
  const language = languageOf(path);
  if (language !== "nextflow" && language !== "config")
    return {
      path,
      text,
      language,
      status: "plain",
      ast: null,
      problems: [],
      comments: [],
    };

  const verbatim = (problems: readonly ParseProblem[]): SourceFile => ({
    path,
    text,
    language,
    status: "verbatim",
    ast: null,
    problems,
    comments: [],
  });

  let file: SourceFile;
  try {
    if (language === "nextflow") {
      const parsed: ScriptSourceParse = parser.parseScript(text);
      file =
        parsed.status === "verbatim"
          ? verbatim(parsed.problems)
          : {
              path,
              text,
              language,
              status: parsed.status,
              ast: parsed.ast,
              problems: parsed.problems,
              comments: parsed.ast.comments,
            };
    } else {
      const parsed: ConfigSourceParse = parser.parseConfig(text);
      file =
        parsed.status === "verbatim"
          ? verbatim(parsed.problems)
          : {
              path,
              text,
              language,
              status: parsed.status,
              ast: parsed.ast,
              problems: parsed.problems,
              comments: parsed.ast.comments,
            };
    }
  } catch (error) {
    return verbatim([
      internal(
        `The parser could not process this file: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ]);
  }
  const issues = verifyModel(file);
  return issues.length === 0
    ? file
    : verbatim([
        ...file.problems,
        internal(`The parsed model did not account for the text: ${issues[0]}`),
      ]);
}
