import {
  type AstNode,
  type Comment,
  childNodes,
  type Range,
  type ScriptAst,
  walk,
} from "@nf-builder/lang-core";
import { CharStream } from "antlr4ng";
import { ScriptLexer } from "../../src/generated/ScriptLexer.ts";
import {
  DECLARATION_KINDS,
  hasRule,
  notReparsed,
  reparse,
} from "./parse-rule.ts";
import { shape } from "./shape.ts";

// F-102 step 2: every AST node's range slices back to its exact source text. `checkRanges` returns the problems found;
// an empty list is a pass. It uses its own, naive position arithmetic, not `PositionIndex`, so a bug there shows up here.

export type CheckOptions = {
  /** Which nodes to re-parse: all of them, only declarations, or none. Default "all". */
  reparse?: "all" | "declarations" | "none";
  /** Comments have been attached: every comment must be in exactly one slot. */
  attached?: boolean;
};

type Boundaries = {
  starts: Set<number>;
  ends: Set<number>;
  comments: Comment[];
};

/** The text's token boundaries (UTF-16 offsets) from a fresh lex, and its comment tokens. */
function lexBoundaries(text: string): Boundaries {
  const offsets = [0];
  for (const ch of text)
    offsets.push((offsets[offsets.length - 1] as number) + ch.length);
  const lexer = new ScriptLexer(CharStream.fromString(text));
  lexer.removeErrorListeners();
  const nl = ScriptLexer.NL;
  const starts = new Set<number>();
  const ends = new Set<number>();
  const comments: Comment[] = [];
  for (const token of lexer.getAllTokens()) {
    const start = offsets[token.start] as number;
    const end = offsets[token.stop + 1] as number;
    const tokenText = token.text ?? "";
    if (token.type === nl) {
      const t = tokenText.trimEnd();
      if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("#!"))
        comments.push({
          kind: t.startsWith("#!") ? "shebang" : "line",
          text: t,
          range: { start, end: start + t.length } as Range,
          ownLine: false,
        });
      continue;
    }
    starts.add(start);
    ends.add(end);
    if (/^\$\w/.test(tokenText)) {
      // a GString path `$a.b.c`: the names inside the token are nodes too
      let at = start + 1;
      for (const [i, name] of tokenText.slice(1).split(".").entries()) {
        if (i > 0) at += 1;
        starts.add(at);
        at += name.length;
        ends.add(at);
      }
    }
  }
  return { starts, ends, comments };
}

/** Line and column of a UTF-16 offset, counted from the text: lines end at "\n", columns count code points. */
function naivePosition(text: string, offset: number) {
  const before = text.slice(0, offset);
  const lastNewline = before.lastIndexOf("\n");
  let line = 1;
  for (const ch of before) if (ch === "\n") line++;
  let column = 1;
  for (const _ of before.slice(lastNewline + 1)) column++;
  return { line, column };
}

const describe = (node: AstNode) =>
  `${node.kind} at ${node.range.line}:${node.range.column}`;

export function checkRanges(
  ast: ScriptAst,
  text: string,
  options: CheckOptions = {},
): string[] {
  const mode = options.reparse ?? "all";
  const problems: string[] = [];
  const { starts, ends, comments } = lexBoundaries(text);

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

  const ancestors = (node: AstNode): AstNode[] => {
    const out: AstNode[] = [];
    for (let p = parentOf.get(node); p; p = parentOf.get(p)) out.push(p);
    return out;
  };
  const parentOf = new Map<AstNode, AstNode>();
  walk(ast, (node, parent) => {
    if (parent) parentOf.set(node, parent);
  });

  walk(ast, (node, parent) => {
    const where = describe(node);
    const r = node.range;
    const slice = text.slice(r.start, r.end);
    const n = node as AstNode & Record<string, unknown>;

    // 1. consistent
    checkRange(where, r);
    if (typeof n.labelRange === "object" && n.labelRange)
      checkRange(`${where} labelRange`, n.labelRange as Range);
    if (typeof n.elseRange === "object" && n.elseRange)
      checkRange(`${where} elseRange`, n.elseRange as Range);

    // 2. token-aligned and tight
    if (node.kind !== "Script") {
      if (!(r.start < r.end)) problems.push(`${where}: empty range`);
      if (!starts.has(r.start))
        problems.push(`${where}: starts inside a token (offset ${r.start})`);
      if (!ends.has(r.end))
        problems.push(`${where}: ends inside a token (offset ${r.end})`);
    }

    // 3. nested, and siblings do not overlap
    if (parent) {
      if (r.start < parent.range.start || r.end > parent.range.end)
        problems.push(`${where}: outside its parent ${describe(parent)}`);
    }
    const siblings = childNodes(node).sort(
      (a, b) => a.range.start - b.range.start,
    );
    for (let i = 1; i < siblings.length; i++) {
      const [a, b] = [siblings[i - 1], siblings[i]] as [AstNode, AstNode];
      if (a.range.end > b.range.start)
        problems.push(
          `${where}: children ${describe(a)} and ${describe(b)} overlap`,
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
      case "Identifier":
        expectLeaf(n.name as string, slice.replace(/\s+/g, ""));
        break;
      case "Variable":
        expectLeaf(n.name as string);
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
      case "TypeRef": {
        const compact = slice.replace(/\s+/g, "");
        if (!compact.startsWith(n.name as string))
          problems.push(
            `${where}: slice ${JSON.stringify(slice)} does not start with ${n.name}`,
          );
        if (n.nullable && !compact.endsWith("?"))
          problems.push(`${where}: nullable but the slice does not end with ?`);
        break;
      }
      case "Section":
        if (n.labelRange && n.label)
          expectLeaf(
            `${n.label}:`,
            text
              .slice((n.labelRange as Range).start, (n.labelRange as Range).end)
              .replace(/\s+/g, ""),
          );
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

    // 5. re-parse
    if (
      mode === "all" ||
      (mode === "declarations" && DECLARATION_KINDS.has(node.kind))
    ) {
      const parents = ancestors(node);
      if (!hasRule(node, parents) && !notReparsed(node, parents)) {
        problems.push(`${where}: no re-parse rule for ${node.kind}`);
      } else {
        const result = reparse(node, text, ast.typesEnabled, parents);
        if ("error" in result) problems.push(`${where}: ${result.error}`);
        else if ("node" in result) {
          const before = JSON.stringify(shape(node));
          const after = JSON.stringify(shape(result.node, r.start));
          if (before !== after)
            problems.push(
              `${where}: its slice re-parses to a different node\n  original: ${before}\n  re-parsed: ${after}`,
            );
        }
      }
    }
  });

  // 6. comments
  const slotted: Comment[] = [];
  walk(ast, (node) => {
    for (const slot of [
      "leadingComments",
      "trailingComments",
      "danglingComments",
    ] as const)
      slotted.push(...(node[slot] ?? []));
  });
  for (const c of [
    ...ast.comments,
    ...(ast.shebang ? [ast.shebang] : []),
    ...slotted,
  ])
    if (text.slice(c.range.start, c.range.end) !== c.text)
      problems.push(
        `comment ${JSON.stringify(c.text)} at ${c.range.line}:${c.range.column} does not slice back`,
      );
  const wanted = comments
    .filter((c) => c.kind !== "shebang")
    .map((c) => `${c.range.start}:${c.text}`);
  const got = ast.comments.map((c) => `${c.range.start}:${c.text}`);
  if (JSON.stringify(wanted) !== JSON.stringify(got))
    problems.push(
      `ast.comments is not the comment tokens of a fresh lex, in order`,
    );
  const seen = new Set<Comment>();
  for (const c of slotted) {
    if (seen.has(c))
      problems.push(
        `comment ${JSON.stringify(c.text)} is in more than one slot`,
      );
    seen.add(c);
  }
  if (options.attached && slotted.length !== ast.comments.length)
    problems.push(
      `${slotted.length} of ${ast.comments.length} comments are attached`,
    );

  return problems;
}
