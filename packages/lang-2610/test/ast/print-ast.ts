import { type AstNode, childNodes, type Range } from "@nf-builder/lang-core";

// The snapshot format (a test helper, not product code): one line per node, indented two spaces per level,
// `<field>[<i>] <Kind> <scalars> <line:col-endLine:endCol>`, and for a node without children the JSON-escaped source slice.
// Children come in `childNodes` order. Null fields and empty arrays are omitted. Comments print as pseudo-children.

const NOT_CHILDREN = new Set([
  "leadingComments",
  "trailingComments",
  "danglingComments",
  "comments",
  "shebang",
]);
const rangeText = (r: Range) =>
  `${r.line}:${r.column}-${r.endLine}:${r.endColumn}`;
const isNode = (v: unknown): v is AstNode =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as AstNode).kind === "string" &&
  typeof (v as AstNode).range === "object";
const isRange = (v: unknown): v is Range =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Range).start === "number" &&
  typeof (v as Range).endColumn === "number";

type Comment = { kind: string; text: string; range: Range };

function scalars(node: AstNode, slice: string, leaf: boolean): string {
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "kind" || key === "range" || key === "text") continue;
    if (key === "name" && leaf) continue; // the slice shows it
    if (isRange(value)) {
      out.push(`${key}=${rangeText(value)}`);
    } else if (typeof value === "string") {
      // `value` of a string literal is shown only when unescaping changed it
      if (key === "value" && node.kind === "String" && slice === value)
        continue;
      if (key === "value" && node.kind === "GStringText" && slice === value)
        continue;
      if (
        key === "value" &&
        leaf &&
        node.kind !== "String" &&
        node.kind !== "GStringText"
      )
        continue;
      out.push(`${key}=${JSON.stringify(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      if (key === "value" && leaf) continue;
      out.push(`${key}=${value}`);
    }
  }
  return out.join(" ");
}

function printComment(
  label: string,
  c: Comment,
  indent: string,
  lines: string[],
): void {
  lines.push(
    `${indent}${label} ${c.kind} ${rangeText(c.range)} ${JSON.stringify(c.text)}`,
  );
}

function print(
  node: AstNode,
  label: string | null,
  text: string,
  depth: number,
  lines: string[],
): void {
  const indent = "  ".repeat(depth);
  const children = childNodes(node);
  const leaf = children.length === 0;
  const slice = text.slice(node.range.start, node.range.end);
  const parts = [
    label,
    node.kind,
    scalars(node, slice, leaf),
    rangeText(node.range),
  ];
  if (leaf && node.kind !== "Script") parts.push(JSON.stringify(slice));
  lines.push(`${indent}${parts.filter((p) => p).join(" ")}`);

  const inner = "  ".repeat(depth + 1);
  const rec = node as unknown as Record<string, unknown>;
  const shebang = rec.shebang as Comment | null | undefined;
  if (shebang) printComment("shebang", shebang, inner, lines);
  for (const [i, c] of (
    (rec.comments as Comment[] | undefined) ?? []
  ).entries())
    printComment(`comments[${i}]`, c, inner, lines);
  for (const [i, c] of (
    (rec.leadingComments as Comment[] | undefined) ?? []
  ).entries())
    printComment(`leadingComments[${i}]`, c, inner, lines);

  for (const [key, value] of Object.entries(node)) {
    if (NOT_CHILDREN.has(key)) continue;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (isNode(item)) print(item, `${key}[${i}]`, text, depth + 1, lines);
      });
    } else if (isNode(value)) {
      print(value, key, text, depth + 1, lines);
    }
  }

  for (const [i, c] of (
    (rec.trailingComments as Comment[] | undefined) ?? []
  ).entries())
    printComment(`trailingComments[${i}]`, c, inner, lines);
  for (const [i, c] of (
    (rec.danglingComments as Comment[] | undefined) ?? []
  ).entries())
    printComment(`danglingComments[${i}]`, c, inner, lines);
}

export function printAst(node: AstNode, text: string): string {
  const lines: string[] = [];
  print(node, null, text, 0, lines);
  return `${lines.join("\n")}\n`;
}
