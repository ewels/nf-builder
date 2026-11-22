import { describe, expect, it } from "vitest";
import { collectComments } from "../../src/ast/comments.ts";
import { PositionIndex } from "../../src/ast/positions.ts";
import { parseScript } from "../../src/parser/parse.ts";

function collect(text: string) {
  const outcome = parseScript(text);
  if (!outcome.ok) throw new Error(outcome.error.message);
  outcome.tokens.fill();
  return collectComments(outcome.tokens.getTokens(), new PositionIndex(text));
}

describe("F-102: comment collection", () => {
  it("F-102: comment collection keeps exact text, marks own-line comments and handles CRLF and code points", () => {
    const text = "println 1 // a\n/* b */\n/** d */\nprintln 2 /* e\n f */\n";
    const { comments, shebang } = collect(text);
    expect(shebang).toBeNull();
    expect(comments.map((c) => [c.kind, c.text, c.ownLine])).toEqual([
      ["line", "// a", false],
      ["block", "/* b */", true],
      ["doc", "/** d */", true],
      ["block", "/* e\n f */", false],
    ]);
    // Every comment's range slices back to its exact text.
    for (const c of comments)
      expect(text.slice(c.range.start, c.range.end)).toBe(c.text);
    expect(comments[0]?.range).toMatchObject({
      line: 1,
      column: 11,
      endLine: 1,
      endColumn: 15,
    });

    // CRLF: the text keeps its CR, the line count advances once per CRLF.
    const crlf = "println 1\r\n/* x\r\n y */\r\n// z\r\n";
    const withCrlf = collect(crlf);
    expect(withCrlf.comments.map((c) => c.text)).toEqual([
      "/* x\r\n y */",
      "// z",
    ]);
    for (const c of withCrlf.comments)
      expect(crlf.slice(c.range.start, c.range.end)).toBe(c.text);
    expect(withCrlf.comments[1]?.range).toMatchObject({ line: 4, column: 1 });

    // An astral character before a comment: offsets count UTF-16 units, columns count code points.
    const astral = 'println "𝐀" // c\n';
    const [c] = collect(astral).comments;
    expect(astral.slice(c?.range.start, c?.range.end)).toBe("// c");
    expect(c?.range).toMatchObject({ line: 1, column: 13, endColumn: 17 });
  });

  it("F-102 AR-01: the shebang is kept apart from the comments", () => {
    const { shebang, comments } = collect(
      "#!/usr/bin/env nextflow\n// c\nprintln 1\n",
    );
    expect(shebang).toMatchObject({
      kind: "shebang",
      text: "#!/usr/bin/env nextflow",
      ownLine: true,
    });
    expect(comments.map((c) => c.text)).toEqual(["// c"]);
  });
});
