import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AstNode, type ScriptAst, walk } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import { checkRanges } from "./check-ranges.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(dir, "fixtures.json"), "utf8"),
) as { fixtures: { file: string }[] };

function build(text: string): ScriptAst {
  const result = parseScriptAst(text);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.ast;
}
const find = (ast: ScriptAst, match: (node: AstNode) => boolean) => {
  const found: AstNode[] = [];
  walk(ast, (node) => {
    if (match(node)) found.push(node);
  });
  return found;
};
const slice = (text: string, node: AstNode | undefined) =>
  text.slice(node?.range.start, node?.range.end);

describe("F-102 step 2: every node's range slices back to its exact source text", () => {
  for (const { file } of manifest.fixtures) {
    it(`F-102 step 2 AR-02: every node's range in ${file} slices back to its exact source text`, () => {
      const text = readFileSync(join(dir, "fixtures", file), "utf8");
      expect(checkRanges(build(text), text, { reparse: "all" })).toEqual([]);
    });
  }

  it("F-102 step 2 AR-02: ranges count code points in columns and UTF-16 units in offsets", () => {
    const text = 'x = 1\nv = "𝐀𝐀" + w\n';
    const ast = build(text);
    const [binary] = find(ast, (n) => n.kind === "Binary");
    expect(binary?.range).toEqual({
      start: 10,
      end: 20,
      line: 2,
      column: 5,
      endLine: 2,
      endColumn: 13,
    });
    expect(slice(text, binary)).toBe('"𝐀𝐀" + w');
    const [w] = find(
      ast,
      (n) =>
        n.kind === "Variable" &&
        (n as unknown as { name: string }).name === "w",
    );
    expect(w?.range).toMatchObject({ column: 12, start: 19 });
    expect(checkRanges(ast, text)).toEqual([]);
  });

  it("F-102 step 2: CRLF files keep exact slices and count one line per CRLF", () => {
    const layout = (ast: ScriptAst) =>
      find(ast, () => true).map((n) => [
        n.kind,
        n.range.line,
        n.range.column,
        n.range.endLine,
        n.range.endColumn,
      ]);
    for (const file of ["stmt-if-else.nf", "expr-strings.nf", "comments.nf"]) {
      const lf = readFileSync(join(dir, "fixtures", file), "utf8");
      const crlf = lf.replaceAll("\n", "\r\n");
      const ast = build(crlf);
      expect(layout(ast), file).toEqual(layout(build(lf)));
      expect(checkRanges(ast, crlf), file).toEqual([]);
    }
  });

  it("F-102 step 2: ranges built inside tokens and across tokens are exact", () => {
    const text =
      'def a = "$name.first"\ndef b = -1\ndef c = a >>> b\ndef d = (1 + 2) * 3\n';
    const ast = build(text);
    const one = (kind: string, match: (n: AstNode) => boolean = () => true) =>
      slice(text, find(ast, (n) => n.kind === kind && match(n))[0]);
    expect(one("Interpolation")).toBe("$name.first");
    expect(
      one(
        "Variable",
        (n) => (n as unknown as { name: string }).name === "name",
      ),
    ).toBe("name");
    expect(
      one(
        "Identifier",
        (n) => (n as unknown as { name: string }).name === "first",
      ),
    ).toBe("first");
    expect(one("Unary")).toBe("-1");
    expect(
      one(
        "Binary",
        (n) => (n as unknown as { operator: string }).operator === ">>>",
      ),
    ).toBe("a >>> b");
    expect(one("Parenthesized")).toBe("(1 + 2)");
    const [paren] = find(ast, (n) => n.kind === "Parenthesized");
    expect(
      slice(text, (paren as unknown as { expression: AstNode }).expression),
    ).toBe("1 + 2");
    expect(checkRanges(ast, text)).toEqual([]);
  });

  it("F-102 step 2: the range checker rejects a range one character too wide or too narrow", () => {
    const text = "foo(a, b)\n";
    const widen = (
      change: (node: AstNode & Record<string, unknown>) => void,
      match: (node: AstNode) => boolean,
    ) => {
      const ast = structuredClone(build(text));
      const [node] = find(ast, match);
      change(node as AstNode & Record<string, unknown>);
      return checkRanges(ast, text);
    };
    const grow = (node: AstNode) => {
      const r = node.range as { end: number; endColumn: number };
      r.end += 1;
      r.endColumn += 1;
    };
    const shrink = (node: AstNode) => {
      const r = node.range as { end: number; endColumn: number };
      r.end -= 1;
      r.endColumn -= 1;
    };
    expect(
      widen(
        grow,
        (n) =>
          n.kind === "Variable" &&
          (n as unknown as { name: string }).name === "b",
      ),
    ).not.toEqual([]);
    expect(widen(shrink, (n) => n.kind === "Identifier")).not.toEqual([]);
    // the unchanged tree passes
    expect(checkRanges(build(text), text)).toEqual([]);
  });
});
