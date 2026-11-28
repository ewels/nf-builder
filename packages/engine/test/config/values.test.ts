import type { ConfigValue } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  parseValueText,
  readValue,
  valueExpression,
  valueText,
} from "../../src/config/values";
import { assignOf, expressionOf, parser } from "./helpers";

const read = async (text: string, kind: Parameters<typeof readValue>[1]) =>
  readValue(await expressionOf(text), kind);

describe("F-601 values", () => {
  it("F-601 FI-02: readValue reads each kind's literals, 8.GB and '8 GB' as memory, 2.h and '2h' as duration, and nothing from closures, GStrings or values with comments", async () => {
    expect(await read("'a b'", "string")).toEqual({
      kind: "string",
      value: "a b",
    });
    expect(await read("true", "boolean")).toEqual({
      kind: "boolean",
      value: true,
    });
    expect(await read("4", "integer")).toEqual({ kind: "integer", value: 4 });
    expect(await read("-1", "integer")).toEqual({
      kind: "integer",
      value: -1,
    });
    expect(await read("0.5", "decimal")).toEqual({
      kind: "decimal",
      text: "0.5",
    });
    expect(await read("-2", "decimal")).toEqual({
      kind: "decimal",
      text: "-2",
    });
    expect(await read("8.GB", "memory")).toEqual({
      kind: "memory",
      amount: 8,
      unit: "GB",
    });
    expect(await read("'8 GB'", "memory")).toEqual({
      kind: "memory",
      amount: 8,
      unit: "GB",
    });
    expect(await read("'10GB'", "memory")).toEqual({
      kind: "memory",
      amount: 10,
      unit: "GB",
    });
    expect(await read("2.h", "duration")).toEqual({
      kind: "duration",
      amount: 2,
      unit: "h",
    });
    expect(await read("'2h'", "duration")).toEqual({
      kind: "duration",
      amount: 2,
      unit: "h",
    });
    expect(await read("30.min", "duration")).toEqual({
      kind: "duration",
      amount: 30,
      unit: "min",
    });
    expect(await read("['a', 'b']", "stringList")).toEqual({
      kind: "stringList",
      values: ["a", "b"],
    });
    expect(await read("[]", "stringList")).toEqual({
      kind: "stringList",
      values: [],
    });
    expect(await read("[cpus: 4, memory: 8.GB, time: 2.h]", "map")).toEqual({
      kind: "map",
      entries: [
        { key: "cpus", value: { kind: "integer", value: 4 } },
        { key: "memory", value: { kind: "memory", amount: 8, unit: "GB" } },
        { key: "time", value: { kind: "duration", amount: 2, unit: "h" } },
      ],
    });
    // what the form cannot model
    expect(await read("{ task.attempt * 2.GB }", "memory")).toBeNull();
    expect(await read('"a ${params.x}"', "string")).toBeNull();
    expect(await read("params.x", "string")).toBeNull();
    expect(await read("x ? 'a' : 'b'", "string")).toBeNull();
    expect(await read("['a', params.x]", "stringList")).toBeNull();
    expect(await read("'a'", "integer")).toBeNull();
    expect(await read("1.5.GB", "memory")).toBeNull();
    expect(await read("9007199254740993", "integer")).toBeNull();
    expect(await read("1", "code")).toBeNull();
    expect(await read("['a' /* why */, 'b']", "stringList")).toBeNull();
  });

  it("F-601 FI-02: valueExpression prints the forms the oracle checked", async () => {
    const source = await parser();
    const p = source.configPrinter;
    const print = (value: ConfigValue) =>
      p
        .printConfigStatement(assignOf(valueExpression(value)), {
          layout: source.printer.createLayout(""),
        })
        .text.trimEnd();
    expect(print({ kind: "memory", amount: 8, unit: "GB" })).toBe("x = 8.GB");
    expect(print({ kind: "duration", amount: 2, unit: "h" })).toBe("x = 2.h");
    expect(print({ kind: "duration", amount: 30, unit: "min" })).toBe(
      "x = 30.min",
    );
    expect(print({ kind: "string", value: "it's $HOME" })).toBe(
      "x = 'it\\'s $HOME'",
    );
    expect(print({ kind: "string", value: "a\\b\nc" })).toBe(
      "x = 'a\\\\b\\nc'",
    );
    expect(print({ kind: "stringList", values: ["a", "b"] })).toBe(
      "x = ['a', 'b']",
    );
    expect(
      print({
        kind: "map",
        entries: [
          { key: "cpus", value: { kind: "integer", value: 4 } },
          { key: "memory", value: { kind: "memory", amount: 8, unit: "GB" } },
          { key: "time", value: { kind: "duration", amount: 2, unit: "h" } },
        ],
      }),
    ).toBe("x = [cpus: 4, memory: 8.GB, time: 2.h]");
    expect(print({ kind: "integer", value: -1 })).toBe("x = -1");
    expect(print({ kind: "decimal", text: "0.25" })).toBe("x = 0.25");
    expect(print({ kind: "boolean", value: false })).toBe("x = false");
    expect(() => valueExpression({ kind: "integer", value: 1.5 })).toThrow();
    expect(() => valueExpression({ kind: "decimal", text: "1e3" })).toThrow();
  });

  it("F-601: parseValueText accepts 8.GB, 8 GB, 8GB, 2h, 2 h, 90 m and refuses decimals for memory and duration with a message", () => {
    const ok = (kind: Parameters<typeof parseValueText>[0], text: string) => {
      const r = parseValueText(kind, text);
      if (!r.ok) throw new Error(r.message);
      return r.value;
    };
    for (const text of ["8.GB", "8 GB", "8GB", " 8gb "])
      expect(ok("memory", text)).toEqual({
        kind: "memory",
        amount: 8,
        unit: "GB",
      });
    for (const text of ["2.h", "2h", "2 h"])
      expect(ok("duration", text)).toEqual({
        kind: "duration",
        amount: 2,
        unit: "h",
      });
    expect(ok("duration", "90 m")).toEqual({
      kind: "duration",
      amount: 90,
      unit: "min",
    });
    expect(ok("integer", "-3")).toEqual({ kind: "integer", value: -3 });
    expect(ok("decimal", "0.5")).toEqual({ kind: "decimal", text: "0.5" });
    expect(ok("string", "x y")).toEqual({ kind: "string", value: "x y" });
    expect(ok("boolean", "true")).toEqual({ kind: "boolean", value: true });
    expect(ok("stringList", "a\n\n b \n")).toEqual({
      kind: "stringList",
      values: ["a", "b"],
    });
    for (const [kind, text] of [
      ["memory", "1.5 GB"],
      ["memory", "8"],
      ["memory", "GB"],
      ["duration", "1.5h"],
      ["duration", "2 weeks"],
      ["integer", "1.5"],
      ["integer", "9007199254740993"],
      ["decimal", "1e3"],
      ["boolean", "yes"],
    ] as const) {
      const r = parseValueText(kind, text);
      expect(r.ok, `${kind} ${text}`).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(5);
    }
    expect(parseValueText("memory", "x")).toEqual({
      ok: false,
      message: "Use a whole number and a unit, for example 8.GB",
    });
    expect(parseValueText("code", "x").ok).toBe(false);
  });

  it("F-601: valueText gives the text a field shows, which parseValueText reads back", () => {
    const values: ConfigValue[] = [
      { kind: "memory", amount: 8, unit: "GB" },
      { kind: "duration", amount: 90, unit: "min" },
      { kind: "string", value: "a b" },
      { kind: "integer", value: -2 },
      { kind: "decimal", text: "0.5" },
      { kind: "boolean", value: false },
      { kind: "stringList", values: ["a", "b"] },
    ];
    for (const value of values) {
      const r = parseValueText(value.kind, valueText(value));
      expect(r).toEqual({ ok: true, value });
    }
    expect(valueText({ kind: "memory", amount: 8, unit: "GB" })).toBe("8.GB");
  });
});
