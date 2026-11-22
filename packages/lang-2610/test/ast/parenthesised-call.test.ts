import type { AstNode, ScriptAst } from "@nf-builder/lang-core";
import { walk } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import { checkRanges } from "./check-ranges.ts";

function build(text: string): ScriptAst {
  const result = parseScriptAst(text);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.ast;
}

describe("F-102 AR-02: a closure after a parenthesised call", () => {
  // nf-lang ScriptAstBuilder.java#L1547-L1553 (`pathClosureElement`): when the object is a method call, the closure is
  // added to that call's arguments, whether or not the call was written inside parentheses.
  it("F-102 AR-02: `(foo(1)) { }` appends the closure to the inner call, as ScriptAstBuilder.java#L1547 does", () => {
    const text = "x = (foo(1)) { y -> y }\n";
    const ast = build(text);
    const kinds: string[] = [];
    let call: AstNode | undefined;
    walk(ast, (node) => {
      kinds.push(node.kind);
      if (node.kind === "MethodCall") call = node;
    });
    expect(kinds).not.toContain("Parenthesized");
    expect(kinds).not.toContain("Call");
    const found = call as unknown as {
      args: unknown[];
      closures: unknown[];
      method: { name: string };
      range: { start: number; end: number };
    };
    expect(found.method.name).toBe("foo");
    expect(found.args).toHaveLength(1);
    expect(found.closures).toHaveLength(1);
    expect(text.slice(found.range.start, found.range.end)).toBe(
      "(foo(1)) { y -> y }",
    );
    expect(checkRanges(ast, text, { reparse: "all" })).toEqual([]);
  });

  it("F-102 AR-02: a parenthesised non-call keeps its parentheses before a closure", () => {
    const ast = build("x = (a) { y -> y }\n");
    const kinds: string[] = [];
    walk(ast, (node) => {
      kinds.push(node.kind);
    });
    expect(kinds).toContain("Parenthesized");
    expect(kinds).toContain("Call");
  });
});
