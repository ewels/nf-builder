// Turning a config change into one text edit (F-601, ADR 0032, plan 2.6): everything outside the inserted, replaced or
// removed statement stays byte-identical. Where a statement shares its line with another, the enclosing block is
// reprinted with the config printer instead, which keeps every comment attached to it or refuses.
import type {
  AstNode,
  ConfigApply,
  ConfigApplyBlock,
  ConfigAssign,
  ConfigBlock,
  ConfigSelector,
  ConfigSourceFile,
  ConfigStatement,
  Expression,
  SourceParser,
  TextEdit,
} from "@nf-builder/lang-core";
import { attachedComments } from "../nodes";
import { EditRefusal } from "../refusal";
import type { Container } from "./locate";
import { configAssign } from "./nodes";

const usesCrlf = (text: string): boolean => /\r?\n/.exec(text)?.[0] === "\r\n";
const eolOf = (file: ConfigSourceFile): string =>
  usesCrlf(file.text) ? "\r\n" : "\n";

/** The file's indent unit: a tab, or two spaces, when the first indented line uses them; four spaces otherwise. */
export function indentUnit(text: string): string {
  const first = /^([ \t]+)\S/m.exec(text)?.[1];
  if (first === undefined) return "    ";
  if (first.startsWith("\t")) return "\t";
  return first.length === 2 ? "  " : "    ";
}

/** The text a statement occupies: its leading comments to its trailing comment. */
export function spanOf(node: AstNode): { start: number; end: number } {
  let start = node.range.start;
  let end = node.range.end;
  for (const c of node.leadingComments ?? [])
    start = Math.min(start, c.range.start);
  for (const c of node.trailingComments ?? []) end = Math.max(end, c.range.end);
  return { start, end };
}

const lineStart = (text: string, pos: number): number =>
  text.lastIndexOf("\n", pos - 1) + 1;
const lineEnd = (text: string, pos: number): number => {
  const at = text.indexOf("\n", pos);
  return at < 0 ? text.length : at;
};
const indentOf = (text: string, pos: number): string =>
  /^[ \t]*/.exec(text.slice(lineStart(text, pos)))?.[0] ?? "";
const blankBetween = (text: string, from: number, to: number): boolean =>
  text.slice(from, to).trim() === "";

/** `text` with everything outside `[start, end)` masked; whitespace and line breaks stay, so line numbers match. */
function maskOutside(text: string, start: number, end: number): string {
  // non-blank text becomes `x`, so the layout still sees a token on those lines and counts no blank line before the span
  const blank = (s: string) => s.replace(/\S/g, "x");
  return (
    blank(text.slice(0, start)) +
    text.slice(start, end) +
    blank(text.slice(end))
  );
}

/** The printer lays out in four-space levels; a file that indents otherwise keeps its own unit. */
function withUnit(text: string, unit: string): string {
  if (unit === "    " || /"""|'''/.test(text)) return text;
  return text.replace(/^( {4})+/gm, (m) => unit.repeat(m.length / 4));
}

/** `text` with this file's line endings. */
const withEndings = (file: ConfigSourceFile, text: string): string =>
  usesCrlf(file.text) ? text.replace(/\r?\n/g, "\r\n") : text;

/** The printed form of `node` with a final line break, each line indented by `indent`. */
function render(
  file: ConfigSourceFile,
  parser: SourceParser,
  node: ConfigStatement | ConfigApply,
  indent: string,
  unit: string,
): string {
  const printed = parser.configPrinter.printConfigStatement(node, {
    layout: parser.printer.createLayout(""),
  });
  if (printed.missingComments.length > 0)
    throw new EditRefusal(
      "internal",
      `The printer would drop the comment ${JSON.stringify(printed.missingComments[0]?.text)} in ${file.path}. Nothing was changed.`,
      file.path,
    );
  const body = withUnit(printed.text, unit)
    .split("\n")
    .map((line) => (line === "" ? line : indent + line))
    .join("\n");
  return withEndings(file, body);
}

/** Prints one value expression as the text that follows `name = `. */
export function printValue(
  parser: SourceParser,
  value: Expression,
  depth: number,
): string {
  const printed = parser.configPrinter.printConfigStatement(
    configAssign(["x"], value),
    {
      layout: parser.printer.createLayout(""),
      indent: depth,
    },
  );
  return printed.text
    .replace(/^[ ]*x = /, "")
    .replace(/\n$/, "")
    .replace(/\r$/, "");
}

/** The statements of a container, as a replaceable list. */
function statementsOf(
  c: Container,
): readonly (ConfigStatement | ConfigApply)[] {
  return c.statements;
}

function withStatements(
  c: Container,
  statements: readonly (ConfigStatement | ConfigApply)[],
): Container {
  return { ...c, statements } as Container;
}

/**
 * The container to reprint for a change inside `chain` (outermost first): the innermost one that starts its line, so the
 * text before it is only indentation.
 */
function reprintTarget(
  file: ConfigSourceFile,
  chain: readonly Container[],
): number {
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = chain[i] as Container;
    const start = spanOf(c).start;
    if (blankBetween(file.text, lineStart(file.text, start), start)) return i;
  }
  return -1;
}

/** Replaces `chain[index]` by `updated` inside its parents, up to `chain[target]`: the new version of `chain[target]`. */
function rebuild(
  chain: readonly Container[],
  index: number,
  target: number,
  updated: Container,
): Container {
  let current = updated;
  for (let i = index; i > target; i--) {
    const parent = chain[i - 1] as Container;
    current = withStatements(
      parent,
      statementsOf(parent).map((s) => (s === chain[i] ? current : s)),
    );
  }
  return current;
}

/** The edit that reprints `chain[index]` as `updated`, in place of its own span. */
function reprint(
  file: ConfigSourceFile,
  parser: SourceParser,
  chain: readonly Container[],
  index: number,
  updated: Container,
): TextEdit {
  const original = chain[index] as Container;
  const span = spanOf(original);
  const kept = new Set(attachedComments(updated));
  const lost = attachedComments(original).filter((c) => !kept.has(c));
  if (lost.length > 0)
    throw new EditRefusal(
      "internal",
      `This edit would drop the comment ${JSON.stringify(lost[0]?.text)} in ${file.path}. Nothing was changed.`,
      file.path,
    );
  const printed = parser.configPrinter.printConfigStatement(updated, {
    layout: parser.printer.createLayout(
      maskOutside(file.text, span.start, span.end),
    ),
    indent: index,
  });
  if (printed.missingComments.length > 0)
    throw new EditRefusal(
      "internal",
      `The printer would drop the comment ${JSON.stringify(printed.missingComments[0]?.text)} in ${file.path}. Nothing was changed.`,
      file.path,
    );
  const text = withUnit(printed.text, indentUnit(file.text)).replace(/\n$/, "");
  return {
    start: lineStart(file.text, span.start),
    end: span.end,
    text: withEndings(file, text),
  };
}

export interface Insertion {
  /** The container to insert into; null for the top level. */
  readonly into: Container | null;
  /** The containers from the top level down to `into`. */
  readonly chain: readonly Container[];
  /** Insert after this statement; null for an empty container. At the top level the last item when omitted. */
  readonly after: AstNode | null;
  /** A blank line before it (new top-level blocks). */
  readonly blank?: boolean;
  /** The last top-level item, for an insertion at the top level without `after`. */
  readonly last?: AstNode | null;
}

/** The edit that inserts `node` as a new statement. */
export function insertStatement(
  file: ConfigSourceFile,
  parser: SourceParser,
  node: ConfigStatement | ConfigApply,
  at: Insertion,
): TextEdit {
  const text = file.text;
  const eol = eolOf(file);
  const unit = indentUnit(text);

  if (at.into === null) {
    const after = at.after ?? at.last ?? null;
    const body = render(file, parser, node, "", unit);
    const blank = at.blank === true ? eol : "";
    if (after === null) {
      const lead =
        text.length === 0
          ? ""
          : (text.endsWith("\n") ? "" : eol) +
            (text.trim() === "" ? "" : blank);
      return { start: text.length, end: text.length, text: lead + body };
    }
    const end = spanOf(after).end;
    const le = lineEnd(text, end);
    if (!blankBetween(text, end, le))
      return {
        start: end,
        end,
        text: eol + blank + body.replace(/\r?\n$/, ""),
      };
    if (le === text.length)
      return { start: le, end: le, text: eol + blank + body };
    return { start: le + 1, end: le + 1, text: blank + body };
  }

  const into = at.into;
  const closeIdx = into.range.end - 1;
  const oneLine = into.range.line === into.range.endLine;
  const after = at.after;
  let shared = oneLine;
  if (!shared && after !== null) {
    const end = spanOf(after).end;
    shared = !blankBetween(text, end, lineEnd(text, end));
  }
  if (!shared && after === null)
    shared = !blankBetween(text, lineStart(text, closeIdx), closeIdx);
  if (shared) {
    const index = at.chain.length - 1;
    const target = reprintTarget(file, at.chain);
    const list = statementsOf(into);
    const position =
      after === null ? list.length : list.indexOf(after as ConfigStatement) + 1;
    const updated = withStatements(into, [
      ...list.slice(0, position),
      node,
      ...list.slice(position),
    ] as never);
    if (target < 0)
      throw new EditRefusal(
        "invalid",
        `The block shares its line with other code, so it can't be edited here. Edit it in code.`,
        file.path,
      );
    return reprint(
      file,
      parser,
      at.chain,
      target,
      rebuild(at.chain, index, target, updated),
    );
  }
  if (after !== null) {
    const indent = indentOf(text, after.range.start);
    const pos = lineEnd(text, spanOf(after).end) + 1;
    return {
      start: pos,
      end: pos,
      text: render(file, parser, node, indent, unit),
    };
  }
  const pos = lineStart(text, closeIdx);
  const indent = indentOf(text, into.range.start) + unit;
  return {
    start: pos,
    end: pos,
    text: render(file, parser, node, indent, unit),
  };
}

/** The edit that replaces `assign`'s value by `value`; null when the printed text is the one already there. */
export function replaceValue(
  file: ConfigSourceFile,
  parser: SourceParser,
  assign: ConfigAssign,
  value: Expression,
  depth: number,
): TextEdit | null {
  const range = assign.value.range;
  if (
    file.comments.some(
      (c) => c.range.start >= range.start && c.range.end <= range.end,
    )
  )
    throw new EditRefusal(
      "invalid",
      "The value has a comment inside it, so the form won't replace it. Edit it in code.",
      file.path,
    );
  const text = withEndings(file, printValue(parser, value, depth));
  if (file.text.slice(range.start, range.end) === text) return null;
  return { start: range.start, end: range.end, text };
}

/** `container` without the statements in `gone`, at any depth. */
function prune(container: Container, gone: ReadonlySet<AstNode>): Container {
  return withStatements(
    container,
    statementsOf(container)
      .filter((s) => !gone.has(s))
      .map((s) =>
        s.kind === "ConfigBlock" ||
        s.kind === "ConfigSelector" ||
        s.kind === "ConfigApplyBlock"
          ? prune(s as Container, gone)
          : s,
      ) as never,
  );
}

export interface Removal {
  readonly node: ConfigAssign | ConfigApply;
  readonly ancestors: readonly Container[];
}

/**
 * The edits that remove statements: each as whole lines (own-line leading comments, the statement, its trailing comment
 * and the line break); where another statement shares those lines, the enclosing block is reprinted without it.
 */
export function removeStatements(
  file: ConfigSourceFile,
  parser: SourceParser,
  removals: readonly Removal[],
): TextEdit[] {
  const text = file.text;
  const gone = new Set<AstNode>(removals.map((r) => r.node));
  const edits: TextEdit[] = [];
  const reprinted: { index: number; chain: readonly Container[] }[] = [];
  for (const { node, ancestors } of removals) {
    const span = spanOf(node);
    const ls = lineStart(text, span.start);
    const le = lineEnd(text, span.end);
    if (
      blankBetween(text, ls, span.start) &&
      blankBetween(text, span.end, le)
    ) {
      edits.push({
        start: ls,
        end: Math.min(le + 1, text.length),
        text: "",
      });
      continue;
    }
    const index = reprintTarget(file, ancestors);
    if (index < 0)
      throw new EditRefusal(
        "invalid",
        "The statement shares its line with other code, so it can't be removed here. Edit it in code.",
        file.path,
      );
    reprinted.push({ index, chain: ancestors });
  }
  for (const { index, chain } of reprinted) {
    const target = chain[index] as Container;
    edits.push(reprint(file, parser, chain, index, prune(target, gone)));
  }
  // a reprinted block replaces the whole-line deletions inside it, and another reprint inside it
  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: TextEdit[] = [];
  for (const e of edits) {
    const outer = kept[kept.length - 1];
    if (
      outer &&
      e.start < outer.end &&
      outer.text !== "" &&
      e.start >= outer.start
    )
      continue;
    kept.push(e);
  }
  return kept;
}

export type { ConfigApplyBlock, ConfigBlock, ConfigSelector };
