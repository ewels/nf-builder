import { type AstNode, walk } from "@nf-builder/lang-core";
import { type ParserRuleContext, Trees } from "antlr4ng";
import { describe, expect, it } from "vitest";
import { BuildContext } from "../../src/ast/build/context.ts";
import { expression } from "../../src/ast/build/expressions.ts";
import { ConfigParser } from "../../src/generated/ConfigParser.ts";
import type { ExpressionContext } from "../../src/generated/ScriptParser.ts";
import { parseConfig } from "../../src/parser/parse.ts";

// F-103 builds config expressions with the script expression builder: both grammars share the expression rules, and the
// builder reads operators from token text and tells alternatives apart by accessor, not by class (see expressions.ts).

describe("F-103 AR-02: the script expression builder builds config expressions", () => {
  it("F-102 AR-02 ADR-0027: expressions of a ConfigParser parse build with the script builder, with exact ranges", () => {
    const text = [
      "process {",
      "    memory = { 2.GB * task.attempt }",
      "    errorStrategy = 'retry'",
      "    cpus = (params.x ?: 1) + 1",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Nextflow source, not a template
      '    queue = "q-${params.name}"',
      "    tag = [a: 1, (b): 2].collect { k, v -> v as String }",
      "    pre = { def v = 1; def (a, b) = [1, 2]; String s = 'x'; (a, b) = [v, v]; try { v } catch (IOException e) { v }; v }",
      "}",
      "",
    ].join("\n");
    const outcome = parseConfig(text);
    if (!outcome.ok) throw new Error(outcome.error.message);
    const cx = new BuildContext(text, outcome.tokens);
    const assigns = Trees.findAllRuleNodes(
      outcome.tree,
      ConfigParser.RULE_configAssign,
    ) as (ParserRuleContext & { expression(): ExpressionContext })[];
    // The config contexts are cast to the script context type; only the compiler needs the cast.
    const built = assigns.map((a) =>
      expression(a.expression() as unknown as ExpressionContext, cx),
    );

    expect(built.map((n) => n.kind)).toEqual([
      "Closure",
      "String",
      "Binary",
      "GString",
      "MethodCall",
      "Closure",
    ]);
    expect(built.map((n) => text.slice(n.range.start, n.range.end))).toEqual([
      "{ 2.GB * task.attempt }",
      "'retry'",
      "(params.x ?: 1) + 1",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Nextflow source, not a template
      '"q-${params.name}"',
      "[a: 1, (b): 2].collect { k, v -> v as String }",
      "{ def v = 1; def (a, b) = [1, 2]; String s = 'x'; (a, b) = [v, v]; try { v } catch (IOException e) { v }; v }",
    ]);

    // Operators come from token text (the token types differ between the two lexers), and the closure body is built by
    // the shared statement builder.
    const kinds = new Set<string>();
    const operators: string[] = [];
    for (const node of built)
      walk(node, (n: AstNode) => {
        kinds.add(n.kind);
        const operator = (n as { operator?: string }).operator;
        if (operator) operators.push(operator);
      });
    expect(operators).toEqual(["*", "+", "="]);
    for (const kind of [
      "ExpressionStatement",
      "Parenthesized",
      "Elvis",
      "Interpolation",
      "Map",
      "MapEntry",
      "Cast",
      "Parameter",
      "VariableDeclaration",
      "Assignment",
      "TupleTarget",
      "TryCatch",
      "Catch",
    ])
      expect(kinds, kind).toContain(kind);
  });
});
