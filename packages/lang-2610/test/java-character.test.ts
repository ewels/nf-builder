import { describe, expect, it } from "vitest";
import {
  isIdentifierIgnorable,
  isJavaIdentifierPart,
  isJavaIdentifierStart,
  isUpperCase,
  toCodePoint,
} from "../src/parser/java-character.ts";
import fixture from "./fixtures/java-character.json" with { type: "json" };

describe("java-character", () => {
  it("ADR-0005: Java Character ports agree with Java 21 on sampled code points", () => {
    expect(fixture.generatedBy).toContain("jshell");
    expect(fixture.cases.length).toBeGreaterThan(500);
    const wrong: string[] = [];
    for (const c of fixture.cases) {
      const got = {
        start: isJavaIdentifierStart(c.cp),
        part: isJavaIdentifierPart(c.cp),
        ignorable: isIdentifierIgnorable(c.cp),
        upper: isUpperCase(c.cp),
      };
      const want = {
        start: c.start,
        part: c.part,
        ignorable: c.ignorable,
        upper: c.upper,
      };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(
          `U+${c.cp.toString(16)}: got ${JSON.stringify(got)}, Java says ${JSON.stringify(want)}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("ADR-0005: toCodePoint joins a surrogate pair and rejects invalid code points", () => {
    expect(toCodePoint(0xd83d, 0xde00)).toBe(0x1f600);
    expect(isJavaIdentifierPart(-1)).toBe(false);
    expect(isJavaIdentifierStart(0x110000)).toBe(false);
  });
});
