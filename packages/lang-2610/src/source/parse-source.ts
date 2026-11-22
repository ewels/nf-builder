// The parser with declaration-level fallback (ADR 0004, F-104). Whole file first: a file the builder accepts keeps its
// exact AST, and the items it reported errors for are isolated as `Unparsed`. A file that does not parse is kept
// verbatim here; the chunked path for it comes with F-104 task 3b.
import type {
  ConfigSourceParse,
  ParseProblem,
  ScriptSourceParse,
  SourceParse,
} from "@nf-builder/lang-core";
import { parseConfigAst, parseScriptAst } from "../ast/index.ts";
import { isolate } from "./isolate.ts";

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

export function parseScriptSource(text: string): ScriptSourceParse {
  try {
    const whole = parseScriptAst(text);
    if (!whole.ok)
      return { status: "verbatim", ast: null, problems: whole.errors };
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
    const whole = parseConfigAst(text);
    if (!whole.ok)
      return { status: "verbatim", ast: null, problems: whole.errors };
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

export type { SourceParse };
