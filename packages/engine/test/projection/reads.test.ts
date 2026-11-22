import type { Expression, VariableDeclaration } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { installedPackVersions } from "../../src/packs";
import { variablesRead } from "../../src/projection/reads";
import { loadParser } from "../../src/source/parser";

let parse: (text: string) => Expression;
beforeAll(async () => {
  const parser = await loadParser(installedPackVersions()[0] as string);
  parse = (text) => {
    const ast = parser.parseScript(`def x = ${text}\n`).ast;
    const declaration = ast?.body[0] as VariableDeclaration;
    return declaration.initializer as Expression;
  };
});

const reads = (text: string, options?: { closures?: boolean }) =>
  variablesRead(parse(text), options).map(
    (r) => `${r.name}${r.properties.map((p) => `.${p}`).join("")}`,
  );

describe("F-106 AR-10 reads", () => {
  it("F-106 AR-10: variablesRead finds the variables an expression reads and the property read from each", () => {
    expect(reads("record(input: s, fasta: file(x))")).toEqual(["s", "x"]);
    expect(reads("params.a.b")).toEqual(["params.a.b"]);
    const [read] = variablesRead(parse("params.a.b"));
    expect(read?.name).toBe("params");
    expect(read?.property).toBe("a");
    expect(read?.properties).toEqual(["a", "b"]);
    expect(reads("res.txt")).toEqual(["res.txt"]);
    expect(reads("ch.map { v -> v + k }")).toEqual(["ch", "k"]);
    expect(reads("ch.map { it + k }")).toEqual(["ch", "k"]);
    expect(reads("ch.map { def y = v; y + z }")).toEqual(["ch", "v", "z"]);
    expect(reads(`"\${a} and $b.c"`)).toEqual(["a", "b.c"]);
    expect(reads("[(k): v, name: w]")).toEqual(["k", "v", "w"]);
    expect(reads("a.b[i].c")).toEqual(["a.b", "i"]);
    expect(reads("a?.b")).toEqual(["a.b"]);
    // a spread is not a property step: `a*.name` reads `a` whole
    expect(reads("a*.name")).toEqual(["a"]);
    expect(reads("a.b*.c")).toEqual(["a.b"]);
  });

  it("F-106 AR-10: reads inside closures can be left out, for wiring", () => {
    expect(reads("ch.map { v -> v + k }", { closures: false })).toEqual(["ch"]);
    expect(reads("f(a, { b })", { closures: false })).toEqual(["a"]);
  });

  it("F-106 AR-10: property, method and named-argument keys aren't reads", () => {
    expect(reads("foo.bar(baz: 1)")).toEqual(["foo"]);
    expect(reads("bar(1)")).toEqual([]);
    expect(reads("'x'")).toEqual([]);
  });
});
