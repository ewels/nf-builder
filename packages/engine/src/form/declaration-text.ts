// A declaration's own text, parsed and formatted alone (F-304, UX-43, UX-44). A typed process only parses as typed after
// the file's feature flags, so they are put in front of the text and the problem lines shifted back.
import type {
  Declaration,
  LegacyProcess,
  ParseProblem,
  ScriptSourceFile,
  SourceParser,
  TypedProcess,
} from "@nf-builder/lang-core";
import { itemSpan } from "../edit/splice";
import { createSourceFile } from "../source/source-file";

/** The text of `d` as the Code tab shows it: from its doc comment to its trailing comment, and where that sits in the file. */
export function declarationSource(
  file: ScriptSourceFile,
  d: Declaration,
): { text: string; start: number; end: number } {
  const { start, end } = itemSpan(d);
  return { text: file.text.slice(start, end), start, end };
}

/** The file's feature-flag statements before `d`, one per line: what the declaration needs in front of it to parse as written. */
export function flagPrefix(file: ScriptSourceFile, d: Declaration): string {
  return (file.ast?.body ?? [])
    .filter((i) => i.kind === "FeatureFlag" && i.range.start < d.range.start)
    .map((i) => {
      const { start, end } = itemSpan(i);
      return file.text.slice(start, end);
    })
    .join("\n");
}

export type ParsedDeclaration =
  | {
      readonly ok: true;
      readonly process: TypedProcess | LegacyProcess;
      readonly file: ScriptSourceFile;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly problems: readonly ParseProblem[];
    };

type Refused = Extract<ParsedDeclaration, { ok: false }>;

export const WRONG_KIND =
  "The Code tab can't change what kind of declaration this is.";
const ONE_ONLY =
  "The Code tab edits one declaration. Remove the other code, such as an include, a function or a second declaration.";

/** The one-file project a declaration is parsed or edited in on its own (F-304). */
export const DECLARATION_PATH = "declaration.nf";

/** `text` after the flag `prefix`, as the one-declaration file is written. */
export function withPrefix(prefix: string, text: string): string {
  return prefix === "" ? text : `${prefix}\n\n${text}`;
}

function refusal(message: string): Refused {
  return {
    ok: false,
    message,
    problems: [
      {
        source: "internal",
        message,
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 1,
      },
    ],
  };
}

/**
 * Parses `text` after `prefix` and requires exactly one process, of the style the file's flags give it (a legacy process parses as legacy when the file has no types flag). Problems come back with lines and columns relative to
 * `text`; one that falls in the prefix goes to the first line.
 */
export function parseDeclarationText(
  parser: SourceParser,
  prefix: string,
  text: string,
): ParsedDeclaration {
  const head = withPrefix(prefix, "");
  const lines = head === "" ? 0 : head.split("\n").length - 1;
  const file = createSourceFile(DECLARATION_PATH, head + text, parser);
  if (file.language !== "nextflow") return refusal(ONE_ONLY);
  if (file.problems.length > 0) {
    const problems = file.problems.map((p) => {
      const line = Math.max(1, p.line - lines);
      const endLine = Math.max(1, p.endLine - lines);
      return {
        ...p,
        line,
        endLine,
        column: p.line - lines < 1 ? 1 : p.column,
        endColumn: p.endLine - lines < 1 ? 1 : p.endColumn,
      };
    });
    return {
      ok: false,
      message: problems[0]?.message ?? "The code doesn't parse.",
      problems,
    };
  }
  const items = (file.ast?.body ?? []).filter(
    (i) => i.range.start >= head.length,
  );
  const only = items[0];
  if (items.length !== 1 || !only) return refusal(ONE_ONLY);
  if (only.kind === "Unparsed") return refusal("The code doesn't parse.");
  if (only.kind !== "Process") return refusal(WRONG_KIND);
  return { ok: true, process: only, file };
}

/** `text` as the printer lays it out, without the final newline; the same text `nextflow lint -format` gives (ADR 0032 apart). */
export function formatDeclarationText(
  parser: SourceParser,
  prefix: string,
  text: string,
): { ok: true; text: string } | Refused {
  const parsed = parseDeclarationText(parser, prefix, text);
  if (!parsed.ok) return parsed;
  const printed = parser.printer.printDeclaration(parsed.process, {
    layout: parser.printer.createLayout(parsed.file.text),
  });
  return { ok: true, text: printed.text.replace(/\r?\n$/, "") };
}
