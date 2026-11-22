import { type ParserRuleContext, Trees } from "antlr4ng";
import { describe, expect, it } from "vitest";
import { contextRange, PositionIndex } from "../../src/ast/positions.ts";
import { ScriptParser } from "../../src/generated/ScriptParser.ts";
import { parseScript } from "../../src/parser/parse.ts";

describe("F-102 step 2: PositionIndex and contextRange", () => {
  it("F-102 step 2: PositionIndex maps code points to UTF-16 offsets, lines and columns", () => {
    // ASCII: the identity.
    const ascii = new PositionIndex("ab\ncd");
    expect(ascii.offset(3)).toBe(3);
    expect(ascii.position(3)).toEqual({ line: 2, column: 1 });
    expect(ascii.range(1, 4)).toEqual({
      start: 1,
      end: 4,
      line: 1,
      column: 2,
      endLine: 2,
      endColumn: 2,
    });

    // `𝐀` is one code point and two UTF-16 units: offsets move on by one after it, columns do not.
    const astral = new PositionIndex("a𝐀b");
    expect(astral.offset(2)).toBe(3);
    expect(astral.position(2)).toEqual({ line: 1, column: 3 });
    expect(astral.range(1, 3)).toMatchObject({ start: 1, end: 4 });

    // CRLF counts one line; a lone CR does not advance the line.
    const crlf = new PositionIndex("a\r\nb");
    expect(crlf.position(3)).toEqual({ line: 2, column: 1 });
    const cr = new PositionIndex("a\rb");
    expect(cr.position(2)).toEqual({ line: 1, column: 3 });
  });

  it("F-102 step 2: contextRange trims leading and trailing NL tokens (a block that ends in a newline and a comment)", () => {
    const text = "workflow {\n    a = 1\n    // end\n}\n";
    const outcome = parseScript(text);
    if (!outcome.ok) throw new Error(outcome.error.message);
    const [block] = Trees.findAllRuleNodes(
      outcome.tree,
      ScriptParser.RULE_blockStatements,
    ) as ParserRuleContext[];
    if (!block?.stop) throw new Error("no blockStatements");
    // The raw context runs on into the newline and the comment...
    expect(text.slice(block.start?.start, block.stop.stop + 1)).toContain(
      "// end",
    );
    // ...the trimmed range ends after `1`.
    const index = new PositionIndex(text);
    const range = contextRange(block, outcome.tokens, index);
    expect(text.slice(range.start, range.end)).toBe("a = 1");
    expect(range).toMatchObject({
      line: 2,
      column: 5,
      endLine: 2,
      endColumn: 10,
    });
  });
});
