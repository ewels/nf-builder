import { describe, expect, it } from "vitest";
import { replaceEscapes, stringValue } from "../../src/ast/build/literals.ts";

describe("F-102: string values", () => {
  it("F-102: unescaped string values follow Groovy", () => {
    // docs/reference/syntax.mdx L721-L739 at the pinned commit
    const table: [string, string][] = [
      ["\\b", "\b"],
      ["\\t", "\t"],
      ["\\n", "\n"],
      ["\\f", "\f"],
      ["\\r", "\r"],
      ["\\s", " "],
      ['\\"', '"'],
      ["\\'", "'"],
      ["\\\\", "\\"],
      ["\\$", "$"],
      ["\\\n", ""],
      ["\\u00e9", "é"],
      ["\\101", "A"],
      ["\\0", "\0"],
    ];
    for (const [sequence, character] of table)
      expect(
        replaceEscapes(`a${sequence}b`, false),
        JSON.stringify(sequence),
      ).toBe(`a${character}b`);
    // A backslash before any other character stays; nf-lang reports it (task 5).
    expect(replaceEscapes("\\q", false)).toBe("\\q");
    // `\\n` is a backslash and an `n`, not a newline.
    expect(replaceEscapes("\\\\n", false)).toBe("\\n");
  });

  it("F-102: triple-quoted strings drop CR, and slashy strings turn only an escaped slash into a slash", () => {
    expect(stringValue("'''a\r\nb'''")).toBe("a\nb");
    expect(stringValue('"""a\\tb"""')).toBe("a\tb");
    expect(stringValue("'it\\'s'")).toBe("it's");
    expect(stringValue("/a\\/b\\d+/")).toBe("a/b\\d+");
    expect(replaceEscapes("a\\/b\\n", true)).toBe("a/b\\n");
  });
});
