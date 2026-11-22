import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Comment, ScriptAst, ScriptItem } from "@nf-builder/lang-core";
import { PrintError } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import { printDeclaration, printScript } from "../../src/printer/index.ts";

function parse(text: string): ScriptAst {
  const result = parseScriptAst(text);
  if (!result.ok) throw new Error(result.errors[0]?.message);
  return result.ast;
}

describe("printer errors", () => {
  it("F-110: printing refuses error-only nodes and scripts that mix statements and declarations", () => {
    const cases: [string, string][] = [
      ["Import", "import java.util.List\n"],
      ["IncompleteDeclaration", "foo.bar.\n"],
      [
        "InvalidDeclaration",
        readFileSync(
          join(
            import.meta.dirname,
            "../../../../tools/corpus/fixtures/section-order.nf",
          ),
          "utf8",
        ),
      ],
      ["IncompleteExpression", "def f() {\n  x = a.\n}\n"],
      ["mixed", "println 'x'\n\ndef f() {\n  1\n}\n"],
    ];
    for (const [label, text] of cases) {
      const ast = parse(text);
      expect(() => printScript(ast), label).toThrow(PrintError);
    }
    const kinds = cases
      .slice(0, 3)
      .map(([, text]) => (parse(text).body[0] as ScriptItem).kind);
    expect(kinds).toEqual([
      "Import",
      "IncompleteDeclaration",
      "InvalidDeclaration",
    ]);
    const declaration = parse("import java.util.List\n").body[0];
    expect(() => printDeclaration(declaration as never)).toThrow(PrintError);
    try {
      printScript(parse("foo.bar.\n"));
    } catch (error) {
      expect((error as PrintError).node.kind).toBe("IncompleteDeclaration");
    }
  });

  it("F-110: a comment on a node the printer never prints is reported as missing", () => {
    const ast = parse("process P {\n    script:\n    'echo'\n}\n");
    const process = ast.body[0] as Extract<ScriptItem, { kind: "Process" }>;
    const comment: Comment = {
      kind: "line",
      text: "// lost",
      range: process.range,
      ownLine: true,
    };
    const tampered = {
      ...ast,
      comments: [comment],
      body: [
        { ...process, name: { ...process.name, leadingComments: [comment] } },
      ],
    } as ScriptAst;
    expect(printScript(tampered).missingComments).toEqual([comment]);
    expect(printScript(tampered).text).not.toContain("lost");
    expect(printDeclaration(tampered.body[0] as never).missingComments).toEqual(
      [comment],
    );
    // and an untouched tree reports none
    expect(printScript(ast).missingComments).toEqual([]);
  });
});
