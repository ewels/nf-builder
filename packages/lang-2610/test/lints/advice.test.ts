import { readFileSync } from "node:fs";
import type { ProjectTree } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { includes } from "../../src/includes/index.ts";
import { PARSE_ADVICE } from "../../src/lints/advice.ts";
import { lints } from "../../src/lints/index.ts";
import { EOF_ERROR_MESSAGE } from "../../src/parser/descriptive-error-strategy.ts";

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

/** The recorded `nextflow lint` messages of the pack's parser and builder test inputs. */
function recordedMessages(): string[] {
  const out = new Set<string>([EOF_ERROR_MESSAGE]);
  for (const file of [
    "ast/errors.json",
    "config-ast/errors.json",
    "ported/cases.json",
  ]) {
    const root = read(file) as {
      cases?: { lint?: { message: string }[] }[];
      fixtures?: { lint?: { message: string }[] }[];
    };
    for (const c of root.cases ?? root.fixtures ?? [])
      for (const e of c.lint ?? []) out.add(e.message);
  }
  return [...out];
}

// Messages the parser and builders do not produce: name resolution, type and agent checks belong to other codes.
const NOT_PARSER =
  /is not defined|cannot be used as a variable|^Agent output|^Agent should have only one output/;

const emptyTree: ProjectTree = {
  isFile: () => false,
  isDirectory: () => false,
};

describe("F-112 advice", () => {
  it("F-112 step 2 LA-30: every parser and builder message the pack can produce gets specific advice", () => {
    const messages = recordedMessages().filter((m) => !NOT_PARSER.test(m));
    expect(messages.length).toBeGreaterThan(50);
    for (const message of messages) {
      const advised = lints.advise("syntax", message);
      expect(advised.startsWith(message), message).toBe(true);
      expect(advised, message).toContain(" -- ");
      // a message without its own clause must match a table row, not the generic default
      if (!message.includes(" -- "))
        expect(
          PARSE_ADVICE.some(([pattern]) => pattern.test(message)),
          `no advice row for: ${message}`,
        ).toBe(true);
    }
  });

  it("F-112 step 2 LA-30: a message with its own ' -- ' clause is kept as written, and an unknown one gets a generic clause", () => {
    expect(lints.advise("syntax", EOF_ERROR_MESSAGE)).toBe(EOF_ERROR_MESSAGE);
    const unknown = lints.advise("syntax", "Something new went wrong");
    expect(unknown).toMatch(/^Something new went wrong -- \S/);
    expect(lints.advise("syntax", "Unexpected input: ','")).toBe(
      `Unexpected input: ',' -- ${PARSE_ADVICE.find(([p]) => p.test("Unexpected input: ','"))?.[1]}`,
    );
  });

  it("F-112 step 2 AR-03: include messages get advice and keep nf-lang's wording as their start", () => {
    const missing = includes.scriptInclude("main.nf", "./gone", emptyTree);
    if (missing.kind !== "missing")
      throw new Error("expected a missing target");
    const cases: [string, string][] = [
      ["include-target", missing.message],
      ["include-not-parsed", includes.notParsed("modules/a.nf")],
      ["include-name", includes.notDefined("hello", "modules/a.nf")],
    ];
    for (const [code, message] of cases) {
      const advised = lints.advise(code, message);
      expect(advised.startsWith(`${message} -- `), code).toBe(true);
      expect(advised.length, code).toBeGreaterThan(message.length + 4);
    }
  });

  it("F-112 step 2: advice is added once, and other codes pass through unchanged", () => {
    const once = lints.advise(
      "include-name",
      "Included name 'x' is not defined in module 'a.nf'",
    );
    expect(lints.advise("include-name", once)).toBe(once);
    expect(lints.advise("deprecated-when", "text")).toBe("text");
    expect(lints.advise("internal", "Rule `x` failed: boom")).toBe(
      "Rule `x` failed: boom -- it is kept as written; edit it as text",
    );
  });
});
