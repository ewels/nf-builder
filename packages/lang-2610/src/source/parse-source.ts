// The parser with declaration-level fallback (ADR 0004, F-104). Whole file first: a file the builder accepts keeps its
// exact AST, and the items it reported errors for are isolated as `Unparsed`. A file that does not parse is split by the
// pre-scanner into top-level chunks; each is parsed alone, its positions are shifted back to the file, and a chunk that
// still fails becomes an `Unparsed` holding its exact text. A file where nothing can be modelled is kept verbatim.
import type {
  Comment,
  ConfigAst,
  ConfigItem,
  ConfigSourceParse,
  ParseProblem,
  ParseResult,
  ScriptAst,
  ScriptItem,
  ScriptSourceParse,
  SourceParse,
  Unparsed,
} from "@nf-builder/lang-core";
import { parseConfigAst, parseScriptAst } from "../ast/index.ts";
import { isolate, rangeOf } from "./isolate.ts";
import { type Chunk, type Grammar, prescan } from "./prescan.ts";
import { shiftPositions } from "./shift.ts";

/** modelled: all items built. partial: some are Unparsed. verbatim: nothing was modelled (a file that fails to parse counts). */
export function statusOf(
  modelled: number,
  unparsed: number,
  failed: boolean,
): "modelled" | "partial" | "verbatim" {
  if (modelled === 0 && (unparsed > 0 || failed)) return "verbatim";
  return unparsed > 0 ? "partial" : "modelled";
}

const statusFor = (items: readonly { kind: string }[], failed: boolean) => {
  const unparsed = items.filter((i) => i.kind === "Unparsed").length;
  return statusOf(items.length - unparsed, unparsed, failed);
};

const internalProblem = (error: unknown): ParseProblem => ({
  source: "internal",
  message: `The parser could not process this text: ${error instanceof Error ? error.message : String(error)}`,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
});

const byStart = (a: Comment, b: Comment) => a.range.start - b.range.start;

type Ast = ScriptAst | ConfigAst;
const itemsOf = (ast: Ast): readonly (ScriptItem | ConfigItem)[] =>
  ast.kind === "Script" ? ast.body : ast.statements;

/** The Unparsed for a chunk that could not be parsed: from its first code (or its first non-blank character) to its last. */
function failedChunk(
  text: string,
  chunk: Chunk,
  problems: readonly ParseProblem[],
): { unparsed: Unparsed | null; comments: Comment[]; shebang: Comment | null } {
  const slice = text.slice(chunk.start, chunk.end);
  const hasCode = chunk.codeStart < chunk.end;
  const start = hasCode
    ? chunk.codeStart
    : chunk.start + (slice.length - slice.trimStart().length);
  const end = chunk.start + slice.trimEnd().length;
  if (end <= start) return { unparsed: null, comments: [], shebang: null };
  const leading = hasCode ? chunk.leadingComments : [];
  const shebang = leading.find((c) => c.kind === "shebang") ?? null;
  const rest = leading.filter((c) => c.kind !== "shebang");
  const unparsed: Unparsed = {
    kind: "Unparsed",
    range: rangeOf(text, start, end),
    text: text.slice(start, end),
    head: chunk.head,
    problems,
    ...(rest.length > 0 ? { leadingComments: rest } : {}),
  };
  return { unparsed, comments: rest, shebang };
}

/** A sub-chunk found in a chunk's slice, in file coordinates. */
const inFile = (sub: Chunk, parent: Chunk): Chunk => ({
  start: sub.start + parent.start,
  end: sub.end + parent.start,
  line: sub.line + parent.line - 1,
  codeStart: sub.codeStart + parent.start,
  head: sub.head,
  leadingComments: shiftPositions(sub.leadingComments, {
    offset: parent.start,
    line: parent.line - 1,
  }),
});

function parseChunks(
  text: string,
  grammar: Grammar,
  problems: readonly ParseProblem[],
): SourceParse<Ast> {
  let typesEnabled = false;
  let shebang: Comment | null = null;
  const items: (ScriptItem | ConfigItem)[] = [];
  const comments: Comment[] = [];
  const dangling: Comment[] = [];
  const handle = (chunk: Chunk, retry: boolean): void => {
    const slice = text.slice(chunk.start, chunk.end);
    const by = { offset: chunk.start, line: chunk.line - 1 };
    let result: ParseResult<Ast>;
    try {
      result =
        grammar === "script"
          ? parseScriptAst(slice, { fragment: true, typesEnabled })
          : parseConfigAst(slice);
      if (result.ok) {
        const ast: Ast = shiftPositions(result.ast, by);
        const errors = shiftPositions(result.errors, by);
        const isolated = isolate(
          itemsOf(ast),
          errors,
          text,
          grammar,
          ast.comments,
          chunk,
        );
        items.push(...isolated.items);
        comments.push(...isolated.comments);
        if (ast.kind === "Script") {
          typesEnabled = ast.typesEnabled;
          shebang ??= ast.shebang;
        }
        dangling.push(...(ast.danglingComments ?? []));
        return;
      }
    } catch (error) {
      result = { ok: false, errors: [internalProblem(error)] };
    }
    // A chunk that does not parse may hold an unclosed bracket or string that swallowed later declarations: look for
    // declaration keywords in column 1 inside it. Chunks that parsed are never split this way (a heredoc in a valid
    // process may have such lines).
    if (retry && grammar === "script") {
      const subs = prescan(slice, grammar, true).chunks;
      if (subs.length > 1) {
        for (const sub of subs) handle(inFile(sub, chunk), false);
        return;
      }
    }
    const failed = failedChunk(text, chunk, shiftPositions(result.errors, by));
    if (failed.unparsed) items.push(failed.unparsed);
    comments.push(...failed.comments);
    shebang ??= failed.shebang;
  };
  for (const chunk of prescan(text, grammar).chunks) handle(chunk, true);
  const status = statusFor(items, true);
  if (status === "verbatim") return { status, ast: null, problems };
  const range = rangeOf(text, 0, text.length);
  comments.sort(byStart);
  const extra = dangling.length > 0 ? { danglingComments: dangling } : {};
  const ast: Ast =
    grammar === "script"
      ? {
          kind: "Script",
          range,
          shebang,
          body: items as ScriptItem[],
          comments,
          typesEnabled,
          ...extra,
        }
      : {
          kind: "ConfigFile",
          range,
          statements: items as ConfigItem[],
          comments,
          ...extra,
        };
  return { status, ast, problems };
}

export const parseScriptChunks = (
  text: string,
  problems: readonly ParseProblem[] = [],
) => parseChunks(text, "script", problems) as ScriptSourceParse;

export const parseConfigChunks = (
  text: string,
  problems: readonly ParseProblem[] = [],
) => parseChunks(text, "config", problems) as ConfigSourceParse;

function parseSource(text: string, grammar: Grammar): SourceParse<Ast> {
  try {
    let whole: ParseResult<Ast>;
    try {
      whole =
        grammar === "script" ? parseScriptAst(text) : parseConfigAst(text);
    } catch (error) {
      whole = { ok: false, errors: [internalProblem(error)] };
    }
    if (!whole.ok) return parseChunks(text, grammar, whole.errors);
    const { items, comments } = isolate(
      itemsOf(whole.ast),
      whole.errors,
      text,
      grammar,
      whole.ast.comments,
    );
    const status = statusFor(items, false);
    if (status === "verbatim")
      return { status, ast: null, problems: whole.errors };
    const ast: Ast =
      whole.ast.kind === "Script"
        ? { ...whole.ast, body: items as ScriptItem[], comments }
        : { ...whole.ast, statements: items as ConfigItem[], comments };
    return { status, ast, problems: whole.errors };
  } catch (error) {
    return {
      status: "verbatim",
      ast: null,
      problems: [internalProblem(error)],
    };
  }
}

export const parseScriptSource = (text: string) =>
  parseSource(text, "script") as ScriptSourceParse;

export const parseConfigSource = (text: string) =>
  parseSource(text, "config") as ConfigSourceParse;
