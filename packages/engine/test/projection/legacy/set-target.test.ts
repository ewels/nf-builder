import type { MethodCall } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { statementVariables } from "../../../src/projection/free-variables";
import { setTarget } from "../../../src/projection/legacy";
import { scriptParser } from "../code/statement";

let statement: Awaited<ReturnType<typeof scriptParser>>["statement"];
beforeAll(async () => {
  statement = (await scriptParser()).statement;
});

const call = (text: string): MethodCall => {
  const s = statement(text);
  if (s.kind !== "ExpressionStatement" || s.expression.kind !== "MethodCall")
    throw new Error(text);
  return s.expression;
};

describe("F-107 AR-14 set and tap targets", () => {
  it("F-107 AR-14 F-108 LA-27: one reading of set and tap, as nf-lang's VariableScopeVisitor L773-L786 and nextflow lint 26.10.7 take it", () => {
    const shapes: [string, string | null][] = [
      ["ch.set { a }", "a"],
      ["ch.tap { a }", "a"],
      ["ch.set({ a })", "a"],
      ["ch.set { v -> v }", "v"],
      ["ch.set { 1 }", null],
      ["ch.set { a; b }", null],
      ["ch.set(1) { a }", null],
      ["ch.set()", null],
      ["ch.map { a }", null],
    ];
    for (const [text, expected] of shapes) {
      expect(setTarget(call(text))?.variable.name ?? null, text).toBe(expected);
      // the free-variable analysis declares exactly what the projector binds
      const writes = statementVariables(statement(text)).writes.map(
        (w) => w.name,
      );
      expect(writes, text).toEqual(expected === null ? [] : [expected]);
    }
  });
});
