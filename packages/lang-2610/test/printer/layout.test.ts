import { describe, expect, it } from "vitest";
import { createLayout, FRESH_LAYOUT } from "../../src/printer/layout.ts";

describe("printer layout", () => {
  it("F-110 LA-45: createLayout counts blank lines as nf-lang's Comments does", () => {
    const layout = createLayout("a = 1\n\n   \n\t\nb = 2\nc = 3\n");
    expect(layout.blankLinesBefore(5)).toBe(3);
    expect(layout.blankLinesBefore(6)).toBe(0);
    // whitespace-only lines are blank; the first line has nothing above it
    expect(layout.blankLinesBefore(1)).toBe(0);
    expect(layout.blankLinesBefore(0)).toBe(0);
    expect(layout.blankLinesBefore(-1)).toBe(0);
  });

  it("F-110 LA-45: createLayout treats the lines of a multi-line string or block comment as content", () => {
    const layout = createLayout(
      ["x = '''", "", "text", "'''", "", "/*", "", "*/", "y = 1", ""].join(
        "\n",
      ),
    );
    // the empty line inside the string is content: only the line after it is blank
    expect(layout.blankLinesBefore(6)).toBe(1);
    expect(layout.blankLinesBefore(3)).toBe(0);
    // the empty line inside the comment is content
    expect(layout.blankLinesBefore(9)).toBe(0);
  });

  it("F-110 LA-45: createLayout counts a CRLF as one line break", () => {
    const layout = createLayout("a = 1\r\n\r\n\r\nb = 2\r\n");
    expect(layout.blankLinesBefore(4)).toBe(2);
    expect(layout.startsLine(4, 1)).toBe(true);
  });

  it("F-110 LA-45: startsLine compares the column of the first token, counted in code points", () => {
    const layout = createLayout("  a = 1\n/* c */ b = 2\n'𝐀' ; c = 3\n");
    expect(layout.startsLine(1, 3)).toBe(true);
    expect(layout.startsLine(1, 1)).toBe(false);
    // a comment is a token: `b` does not start line 2
    expect(layout.startsLine(2, 1)).toBe(true);
    expect(layout.startsLine(2, 9)).toBe(false);
    expect(layout.startsLine(3, 7)).toBe(false);
    expect(layout.startsLine(9, 1)).toBe(false);
    const wide = createLayout("𝐀 = 1; b = 2\n");
    expect(wide.startsLine(1, 1)).toBe(true);
    expect(wide.startsLine(1, 8)).toBe(false);
  });

  it("F-110 LA-45: the fresh layout has no blank lines and no line start", () => {
    expect(FRESH_LAYOUT.blankLinesBefore(5)).toBe(0);
    expect(FRESH_LAYOUT.startsLine(1, 1)).toBe(false);
  });
});
