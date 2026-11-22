import {
  type AstNode,
  type Comment,
  type ConfigAst,
  type ConfigBlock,
  childNodes,
  type Range,
  walk,
} from "@nf-builder/lang-core";
import { parseConfigAst } from "../../src/ast/index.ts";
import { ConfigLexer } from "../../src/generated/ConfigLexer.ts";
import { lexBoundaries, naivePosition } from "../ast/check-ranges.ts";
import { shape } from "../ast/shape.ts";

// F-103 step 2: every config AST node's range slices back to its exact source text. `checkConfigRanges` returns the
// problems found; an empty list is a pass. It does its own position arithmetic, not `PositionIndex`, so a bug there shows.

export type CheckOptions = {
  /** Re-parse every statement and every value on its own and compare. */
  reparse?: boolean;
};

const describeNode = (node: AstNode) =>
  `${node.kind} at ${node.range.line}:${node.range.column}`;

const STATEMENT_WRAPS: Record<string, { prefix: string; suffix: string }> = {
  ConfigAssign: { prefix: "__wrap__ {\n", suffix: "\n}" },
  ConfigBlock: { prefix: "__wrap__ {\n", suffix: "\n}" },
  ConfigInclude: { prefix: "__wrap__ {\n", suffix: "\n}" },
  ConfigIncomplete: { prefix: "__wrap__ {\n", suffix: "\n}" },
  ConfigInvalid: { prefix: "__wrap__ {\n", suffix: "\n}" },
  ConfigSelector: { prefix: "process {\n", suffix: "\n}" },
  ConfigApplyBlock: { prefix: "__wrap__ {\n", suffix: "\n}" },
  ConfigApply: { prefix: "plugins {\n", suffix: "\n}" },
};

/** The node built from the slice alone, with offsets shifted to the original text; or the reason it could not be. */
function reparseStatement(node: AstNode, text: string, parent: AstNode) {
  const wrap = STATEMENT_WRAPS[node.kind];
  if (!wrap) return null;
  const slice = text.slice(node.range.start, node.range.end);
  // a top-level statement is parsed as it is
  if (parent.kind === "ConfigFile") {
    const result = parseConfigAst(slice);
    if (!result.ok)
      return { error: `slice ${JSON.stringify(slice)} does not parse` };
    return { node: result.ast.statements[0], shift: node.range.start };
  }
  const result = parseConfigAst(`${wrap.prefix}${slice}${wrap.suffix}`);
  if (!result.ok)
    return { error: `slice ${JSON.stringify(slice)} does not parse` };
  const outer = result.ast.statements[0] as ConfigBlock | undefined;
  const inner =
    node.kind === "ConfigApply"
      ? (outer as unknown as { statements: AstNode[] }).statements[0]
      : outer?.statements[0];
  return { node: inner, shift: node.range.start - wrap.prefix.length };
}

export function checkConfigRanges(
  ast: ConfigAst,
  text: string,
  options: CheckOptions = {},
): string[] {
  const problems: string[] = [];
  const { starts, ends, comments } = lexBoundaries(text, ConfigLexer);

  const checkRange = (label: string, r: Range) => {
    const from = naivePosition(text, r.start);
    const to = naivePosition(text, r.end);
    if (from.line !== r.line || from.column !== r.column)
      problems.push(
        `${label}: start ${r.start} is ${from.line}:${from.column}, range says ${r.line}:${r.column}`,
      );
    if (to.line !== r.endLine || to.column !== r.endColumn)
      problems.push(
        `${label}: end ${r.end} is ${to.line}:${to.column}, range says ${r.endLine}:${r.endColumn}`,
      );
  };

  walk(ast, (node, parent) => {
    const where = describeNode(node);
    const r = node.range;
    const slice = text.slice(r.start, r.end);
    const n = node as AstNode & Record<string, unknown>;

    // 1. consistent
    checkRange(where, r);
    if (typeof n.elseRange === "object" && n.elseRange)
      checkRange(`${where} elseRange`, n.elseRange as Range);

    // 2. token-aligned and tight
    if (node.kind !== "ConfigFile") {
      if (!(r.start < r.end)) problems.push(`${where}: empty range`);
      if (!starts.has(r.start))
        problems.push(`${where}: starts inside a token (offset ${r.start})`);
      if (!ends.has(r.end))
        problems.push(`${where}: ends inside a token (offset ${r.end})`);
    }

    // 3. nested, and siblings do not overlap
    if (parent && (r.start < parent.range.start || r.end > parent.range.end))
      problems.push(`${where}: outside its parent ${describeNode(parent)}`);
    const children = childNodes(node).sort(
      (a, b) => a.range.start - b.range.start,
    );
    for (let i = 1; i < children.length; i++) {
      const [a, b] = [children[i - 1], children[i]] as [AstNode, AstNode];
      if (a.range.end > b.range.start)
        problems.push(
          `${where}: children ${describeNode(a)} and ${describeNode(b)} overlap`,
        );
    }

    // 4. leaf text
    const expectLeaf = (expected: string, got = slice) => {
      if (got !== expected)
        problems.push(
          `${where}: slice ${JSON.stringify(got)} is not ${JSON.stringify(expected)}`,
        );
    };
    switch (node.kind) {
      case "ConfigName":
        if (n.form === "string") {
          if (!/^(['"]|''')/.test(slice))
            problems.push(
              `${where}: string name slice ${JSON.stringify(slice)} is not quoted`,
            );
        } else expectLeaf(n.name as string);
        break;
      case "Identifier":
      case "Variable":
        expectLeaf(n.name as string, slice.replace(/\s+/g, ""));
        break;
      case "Number":
      case "String":
      case "GStringText":
        expectLeaf(n.text as string);
        break;
      case "Boolean":
        expectLeaf(String(n.value));
        break;
      case "Null":
        expectLeaf("null");
        break;
      case "If":
        if (n.elseRange)
          expectLeaf(
            "else",
            text.slice(
              (n.elseRange as Range).start,
              (n.elseRange as Range).end,
            ),
          );
        break;
    }

    // 5. token accounting: what is left of a config node after its children and comments is its own punctuation
    const accounted: Record<string, (node: Record<string, unknown>) => string> =
      {
        ConfigFile: () => "",
        ConfigBlock: () => "{}",
        ConfigApplyBlock: () => "{}",
        ConfigSelector: () => ":{}",
        ConfigAssign: (x) => `${".".repeat((x.path as unknown[]).length - 1)}=`,
        ConfigInclude: () => "includeConfig",
        ConfigIncomplete: (x) =>
          ".".repeat(
            (x.path as unknown[]).length - 1 + (x.trailingDot ? 1 : 0),
          ),
      };
    const expectedLeft = accounted[node.kind];
    if (expectedLeft) {
      const covered = [
        ...children.map((c) => c.range),
        ...ast.comments.map((c) => c.range),
      ].filter((c) => c.start >= r.start && c.end <= r.end);
      let left = "";
      for (let at = r.start; at < r.end; at++)
        if (!covered.some((c) => c.start <= at && at < c.end)) left += text[at];
      left = left.replace(/[\s;]/g, "");
      const want = expectedLeft(n);
      if (left !== want)
        problems.push(
          `${where}: text outside its children is ${JSON.stringify(left)}, expected ${JSON.stringify(want)}`,
        );
    }

    // 6. re-parse
    if (options.reparse && parent) {
      const result = reparseStatement(node, text, parent);
      if (result) {
        if ("error" in result) problems.push(`${where}: ${result.error}`);
        else if (
          JSON.stringify(shape(node)) !==
          JSON.stringify(shape(result.node, result.shift))
        )
          problems.push(`${where}: its slice re-parses to a different node`);
      }
      const value =
        node.kind === "ConfigAssign"
          ? n.value
          : node.kind === "ConfigInclude"
            ? n.source
            : null;
      if (value) {
        const v = value as AstNode;
        const prefix = "x = ";
        const alone = parseConfigAst(
          `${prefix}${text.slice(v.range.start, v.range.end)}`,
        );
        const rebuilt = alone.ok
          ? (alone.ast.statements[0] as { value?: AstNode })?.value
          : undefined;
        if (!rebuilt)
          problems.push(`${where}: its value slice does not re-parse`);
        else if (
          JSON.stringify(shape(v)) !==
          JSON.stringify(shape(rebuilt, v.range.start - prefix.length))
        )
          problems.push(
            `${where}: its value slice re-parses to a different node`,
          );
      }
    }
  });

  // comments
  for (const c of ast.comments as Comment[])
    if (text.slice(c.range.start, c.range.end) !== c.text)
      problems.push(
        `comment ${JSON.stringify(c.text)} at ${c.range.line}:${c.range.column} does not slice back`,
      );
  const got = ast.comments.map((c) => `${c.range.start}:${c.text}`);
  const wanted = comments.map((c) => `${c.range.start}:${c.text}`);
  if (JSON.stringify(wanted) !== JSON.stringify(got))
    problems.push(
      "ast.comments is not the comment tokens of a fresh lex, in order",
    );

  return problems;
}
