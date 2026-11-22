// The parser with declaration-level fallback (ADR 0004, F-104). Whole file first: a file the builder accepts keeps its
// exact AST, and the items it reported errors for are isolated as `Unparsed`. A file that does not parse is split by the
// pre-scanner into top-level chunks; each is parsed alone, its positions are shifted back to the file, and a chunk that
// still fails becomes an `Unparsed` holding its exact text. A file where nothing can be modelled is kept verbatim.
import type {
  Comment,
  ConfigAst,
  ConfigItem,
  ConfigParseResult,
  ConfigSourceParse,
  ParseProblem,
  ScriptAst,
  ScriptItem,
  ScriptParseResult,
  ScriptSourceParse,
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

const internalProblem = (error: unknown): ParseProblem => ({
  source: "internal",
  message: `The parser could not process this text: ${error instanceof Error ? error.message : String(error)}`,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
});

const byStart = (a: Comment, b: Comment) => a.range.start - b.range.start;

/** The Unparsed for a chunk that could not be parsed: from its first code (or its first non-blank character) to its last. */
function failedChunk(
  text: string,
  chunk: Chunk,
  grammar: Grammar,
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
  void grammar;
  return { unparsed, comments: rest, shebang };
}

const shiftBy = (chunk: Chunk) => ({
  offset: chunk.start,
  line: chunk.line - 1,
});

export function parseScriptChunks(
  text: string,
  problems: readonly ParseProblem[] = [],
): ScriptSourceParse {
  let typesEnabled = false;
  let shebang: Comment | null = null;
  const items: ScriptItem[] = [];
  const comments: Comment[] = [];
  const dangling: Comment[] = [];
  for (const chunk of prescan(text, "script").chunks) {
    const slice = text.slice(chunk.start, chunk.end);
    const by = shiftBy(chunk);
    let result: ScriptParseResult;
    try {
      result = parseScriptAst(slice, { fragment: true, typesEnabled });
      if (result.ok) {
        const ast = shiftPositions(result.ast, by);
        const errors = shiftPositions(result.errors, by);
        const isolated = isolate(
          ast.body,
          errors,
          text,
          "script",
          ast.comments,
          chunk,
        );
        items.push(...isolated.items);
        comments.push(...isolated.comments);
        typesEnabled = ast.typesEnabled;
        shebang ??= ast.shebang;
        dangling.push(...(ast.danglingComments ?? []));
        continue;
      }
    } catch (error) {
      result = { ok: false, errors: [internalProblem(error)] };
    }
    const failed = failedChunk(
      text,
      chunk,
      "script",
      shiftPositions(result.errors, by),
    );
    if (failed.unparsed) items.push(failed.unparsed);
    comments.push(...failed.comments);
    shebang ??= failed.shebang;
  }
  const unparsed = items.filter((i) => i.kind === "Unparsed").length;
  const status = statusOf(items.length - unparsed, unparsed, true);
  if (status === "verbatim") return { status, ast: null, problems };
  const ast: ScriptAst = {
    kind: "Script",
    range: rangeOf(text, 0, text.length),
    shebang,
    body: items,
    comments: comments.sort(byStart),
    typesEnabled,
    ...(dangling.length > 0 ? { danglingComments: dangling } : {}),
  };
  return { status, ast, problems };
}

export function parseConfigChunks(
  text: string,
  problems: readonly ParseProblem[] = [],
): ConfigSourceParse {
  const items: ConfigItem[] = [];
  const comments: Comment[] = [];
  const dangling: Comment[] = [];
  for (const chunk of prescan(text, "config").chunks) {
    const slice = text.slice(chunk.start, chunk.end);
    const by = shiftBy(chunk);
    let result: ConfigParseResult;
    try {
      result = parseConfigAst(slice);
      if (result.ok) {
        const ast = shiftPositions(result.ast, by);
        const errors = shiftPositions(result.errors, by);
        const isolated = isolate(
          ast.statements,
          errors,
          text,
          "config",
          ast.comments,
          chunk,
        );
        items.push(...isolated.items);
        comments.push(...isolated.comments);
        dangling.push(...(ast.danglingComments ?? []));
        continue;
      }
    } catch (error) {
      result = { ok: false, errors: [internalProblem(error)] };
    }
    const failed = failedChunk(
      text,
      chunk,
      "config",
      shiftPositions(result.errors, by),
    );
    if (failed.unparsed) items.push(failed.unparsed);
    comments.push(...failed.comments);
  }
  const unparsed = items.filter((i) => i.kind === "Unparsed").length;
  const status = statusOf(items.length - unparsed, unparsed, true);
  if (status === "verbatim") return { status, ast: null, problems };
  const ast: ConfigAst = {
    kind: "ConfigFile",
    range: rangeOf(text, 0, text.length),
    statements: items,
    comments: comments.sort(byStart),
    ...(dangling.length > 0 ? { danglingComments: dangling } : {}),
  };
  return { status, ast, problems };
}

export function parseScriptSource(text: string): ScriptSourceParse {
  try {
    let whole: ScriptParseResult;
    try {
      whole = parseScriptAst(text);
    } catch (error) {
      whole = { ok: false, errors: [internalProblem(error)] };
    }
    if (!whole.ok) return parseScriptChunks(text, whole.errors);
    const { items, comments } = isolate(
      whole.ast.body,
      whole.errors,
      text,
      "script",
      whole.ast.comments,
    );
    const unparsed = items.filter((i) => i.kind === "Unparsed").length;
    const status = statusOf(items.length - unparsed, unparsed, false);
    return status === "verbatim"
      ? { status, ast: null, problems: whole.errors }
      : {
          status,
          ast: { ...whole.ast, body: items, comments },
          problems: whole.errors,
        };
  } catch (error) {
    return {
      status: "verbatim",
      ast: null,
      problems: [internalProblem(error)],
    };
  }
}

export function parseConfigSource(text: string): ConfigSourceParse {
  try {
    let whole: ConfigParseResult;
    try {
      whole = parseConfigAst(text);
    } catch (error) {
      whole = { ok: false, errors: [internalProblem(error)] };
    }
    if (!whole.ok) return parseConfigChunks(text, whole.errors);
    const { items, comments } = isolate(
      whole.ast.statements,
      whole.errors,
      text,
      "config",
      whole.ast.comments,
    );
    const unparsed = items.filter((i) => i.kind === "Unparsed").length;
    const status = statusOf(items.length - unparsed, unparsed, false);
    return status === "verbatim"
      ? { status, ast: null, problems: whole.errors }
      : {
          status,
          ast: { ...whole.ast, statements: items, comments },
          problems: whole.errors,
        };
  } catch (error) {
    return {
      status: "verbatim",
      ast: null,
      problems: [internalProblem(error)],
    };
  }
}
