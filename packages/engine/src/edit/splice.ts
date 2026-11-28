// Turning an edited declaration into one text edit (AR-22, LA-45, ADR 0032, F-111). The declaration is reprinted, and
// everything else in the file stays byte-identical.
import type {
  AstNode,
  Declaration,
  Include,
  ScriptItem,
  ScriptPrinter,
  ScriptSourceFile,
  TextEdit,
} from "@nf-builder/lang-core";
import { attachedComments } from "./nodes";
import { EditRefusal } from "./refusal";

/** The text an item occupies: from its first leading comment to its trailing comment, or its own range. */
export function itemSpan(item: ScriptItem): { start: number; end: number } {
  let start = item.range.start;
  let end = item.range.end;
  for (const c of item.leadingComments ?? [])
    start = Math.min(start, c.range.start);
  for (const c of item.trailingComments ?? []) end = Math.max(end, c.range.end);
  return { start, end };
}

/** `text` with everything outside `[start, end)` blanked to spaces; line breaks stay, so line numbers match. */
function maskOutside(text: string, start: number, end: number): string {
  const blank = (s: string) => s.replace(/[^\r\n]/g, " ");
  return (
    blank(text.slice(0, start)) +
    text.slice(start, end) +
    blank(text.slice(end))
  );
}

const usesCrlf = (text: string): boolean => /\r?\n/.exec(text)?.[0] === "\r\n";
export const withEndings = (file: ScriptSourceFile, text: string): string =>
  usesCrlf(file.text) ? text.replace(/\r?\n/g, "\r\n") : text;
const withoutFinalNewline = (text: string): string =>
  text.replace(/\r?\n$/, "");

/** Refuses an edit from `original` to `updated` that would drop a comment attached under `original`, apart from those in `removed`. */
export function assertCommentsKept(
  file: ScriptSourceFile,
  original: Declaration,
  updated: Declaration,
  removed: readonly AstNode[] = [],
): void {
  const kept = new Set(attachedComments(updated));
  const gone = new Set(removed.flatMap((n) => attachedComments(n)));
  const lost = attachedComments(original).filter(
    (c) => !kept.has(c) && !gone.has(c),
  );
  if (lost.length > 0)
    throw new EditRefusal(
      "internal",
      `This edit would drop the comment ${JSON.stringify(lost[0]?.text)} in ${file.path}. Nothing was changed.`,
      file.path,
    );
}

/**
 * The edit that replaces `original`'s span with the printed `updated`. Every comment attached under `original` must
 * still be attached under `updated`, unless it sits in one of the `removed` nodes; otherwise the edit is refused.
 */
export function reprintDeclaration(
  file: ScriptSourceFile,
  original: Declaration,
  updated: Declaration,
  printer: ScriptPrinter,
  removed: readonly AstNode[] = [],
): TextEdit {
  const span = itemSpan(original);
  assertCommentsKept(file, original, updated, removed);
  const layout = printer.createLayout(
    maskOutside(file.text, span.start, span.end),
  );
  const printed = printer.printDeclaration(updated, { layout });
  if (printed.missingComments.length > 0)
    throw new EditRefusal(
      "internal",
      `The printer would drop the comment ${JSON.stringify(printed.missingComments[0]?.text)} in ${file.path}. Nothing was changed.`,
      file.path,
    );
  return {
    start: span.start,
    end: span.end,
    text: withEndings(file, withoutFinalNewline(printed.text)),
  };
}

/** The edit that adds `include` to the script, following ADR 0032's layout. */
export function includeInsertion(
  file: ScriptSourceFile,
  include: Include,
  printer: ScriptPrinter,
): TextEdit {
  const printed = withEndings(file, printer.printDeclaration(include).text);
  const nl = withEndings(file, "\n");
  const body = file.ast?.body ?? [];
  const lastOf = (kind: string) => body.filter((i) => i.kind === kind).at(-1);
  const lastInclude = lastOf("Include");
  if (lastInclude) {
    const at = itemSpan(lastInclude).end;
    return { start: at, end: at, text: nl + withoutFinalNewline(printed) };
  }
  const lastFlag = lastOf("FeatureFlag");
  if (lastFlag) {
    const at = itemSpan(lastFlag).end;
    return { start: at, end: at, text: nl + nl + withoutFinalNewline(printed) };
  }
  const first = body[0];
  if (first) {
    const at = itemSpan(first).start;
    return { start: at, end: at, text: printed + nl };
  }
  const at = file.text.length;
  const sep = at === 0 ? "" : file.text.endsWith("\n") ? nl : nl + nl;
  return { start: at, end: at, text: sep + printed };
}
