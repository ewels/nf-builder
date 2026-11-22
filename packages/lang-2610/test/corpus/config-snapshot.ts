import type {
  Comment,
  ConfigApply,
  ConfigAst,
  ConfigItem,
  ConfigName,
  ConfigStatement,
  ParseProblem,
  Range,
} from "@nf-builder/lang-core";

// The statement-level snapshot format of the corpus configs (F-103 step 1): one line per config statement and comment,
// `<indent><Kind> <summary> <line:col-endLine:endCol>`, two spaces per depth. Values appear only as their top node kind;
// comment text is not copied (the corpus is other people's text). A comment is a child of the innermost statement whose
// range holds it, in source order among that statement's children. The format is a test artefact, not a stored format.

const rangeText = (r: Range) =>
  `${r.line}:${r.column}-${r.endLine}:${r.endColumn}`;
const nameText = (n: ConfigName) =>
  n.form === "string" ? `'${n.name}'` : n.name;
const pathText = (path: readonly ConfigName[]) => path.map(nameText).join(".");

type Entry = { line: string; range: Range; children: Entry[] };

function summary(s: ConfigItem | ConfigApply): string {
  switch (s.kind) {
    case "ConfigAssign":
      return `${pathText(s.path)} = ${s.value.kind}`;
    case "ConfigBlock":
    case "ConfigApplyBlock":
      return nameText(s.name);
    case "ConfigApply":
      return `${s.name.name} (${s.args.length} arguments)`;
    case "ConfigSelector":
      return `${s.selector.name}: ${nameText(s.target)}`;
    case "ConfigInclude":
      return s.source.kind === "String"
        ? `String ${JSON.stringify(s.source.value)}`
        : s.source.kind;
    case "ConfigIncomplete":
      return `${pathText(s.path)}${s.trailingDot ? "." : ""}`;
    case "ConfigInvalid":
      return s.statement?.kind ?? "(none)";
    case "Unparsed":
      return s.head ? `${s.head.keyword} ${s.head.name ?? ""}`.trim() : "";
  }
}

function entry(s: ConfigItem | ConfigApply): Entry {
  const children =
    s.kind === "ConfigBlock" ||
    s.kind === "ConfigSelector" ||
    s.kind === "ConfigApplyBlock"
      ? s.statements.map(entry)
      : [];
  return {
    line: `${s.kind} ${summary(s)} ${rangeText(s.range)}`,
    range: s.range,
    children,
  };
}

/** Put each comment under the innermost entry that holds it. */
function place(parent: Entry, comments: readonly Comment[]): void {
  const mine: Comment[] = [];
  for (const c of comments) {
    const holder = parent.children.find(
      (k) => k.range.start <= c.range.start && c.range.end <= k.range.end,
    );
    if (!holder) mine.push(c);
  }
  for (const k of parent.children)
    place(
      k,
      comments.filter(
        (c) => k.range.start <= c.range.start && c.range.end <= k.range.end,
      ),
    );
  for (const c of mine)
    parent.children.push({
      line: `#${c.kind} ${rangeText(c.range)}`,
      range: c.range,
      children: [],
    });
  parent.children.sort((a, b) => a.range.start - b.range.start);
}

const print = (e: Entry, indent: string, out: string[]): void => {
  out.push(`${indent}${e.line}`);
  for (const k of e.children) print(k, `${indent}  `, out);
};

export function renderConfigAst(
  ast: ConfigAst,
  errors: readonly ParseProblem[],
): string {
  const root: Entry = {
    line: `ConfigFile ${rangeText(ast.range)}`,
    range: ast.range,
    children: ast.statements.map(entry),
  };
  place(root, ast.comments);
  const lines: string[] = [];
  print(root, "", lines);
  for (const e of errors)
    lines.push(
      `!error ${e.line}:${e.column}-${e.endLine}:${e.endColumn} ${e.message}`,
    );
  return `${lines.join("\n")}\n`;
}

/** Where a corpus config's snapshot lives, relative to `test/corpus/`. */
export const snapshotPath = (id: string, path: string) =>
  `snapshots/config/${id}/${path}.ast`;
