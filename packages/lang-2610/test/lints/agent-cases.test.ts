import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentOutput } from "../../src/lints/names.ts";
import { context } from "./context.ts";

type Case = {
  id: string;
  file: string;
  owner?: string;
  lint: { line: number; column: number; message: string }[];
};
const ported = join(import.meta.dirname, "../ported");
const cases = (
  JSON.parse(readFileSync(join(ported, "cases.json"), "utf8")) as {
    cases: Case[];
  }
).cases.filter((c) => c.owner === "F-112");

describe("F-112 F-101 agent cases", () => {
  it("F-112 F-101: the eight agent ported cases are the ones owned by F-112", () => {
    expect(cases.map((c) => c.id)).toHaveLength(8);
  });

  for (const c of cases)
    it(`F-112 F-101 LA-31: ${c.id} gets lint's message at lint's position`, () => {
      const text = readFileSync(join(ported, c.file), "utf8");
      const found = agentOutput.check(context(text));
      expect(
        found.map((f) => ({
          line: f.range.line,
          column: f.range.column,
          // ours is lint's wording, then advice
          message: f.message,
        })),
      ).toHaveLength(c.lint.length);
      c.lint.forEach((expected, i) => {
        const f = found[i];
        expect(f?.range.line).toBe(expected.line);
        expect(f?.range.column).toBe(expected.column);
        expect(f?.message.startsWith(expected.message)).toBe(true);
      });
    });
});
