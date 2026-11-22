import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExpressionStatement, Statement } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { statementVariables } from "../../../src/projection/free-variables";
import { variablesRead } from "../../../src/projection/reads";
import { scriptParser } from "./statement";

let statement: (text: string) => Statement;
let workflows: (text: string) => Map<string, readonly Statement[]>;
beforeAll(async () => {
  const parser = await scriptParser();
  statement = parser.statement;
  workflows = parser.workflows;
});

const show = (r: { name: string; properties: readonly string[] }) =>
  [r.name, ...r.properties].join(".");
const reads = (text: string) =>
  statementVariables(statement(text)).reads.map(show);
const writes = (text: string) =>
  statementVariables(statement(text)).writes.map((w) => w.name);

describe("F-108 AR-13 LA-27 free variables", () => {
  it("F-108 AR-13 LA-27: reads are the variables a statement uses before declaring them, every occurrence, with their property path", () => {
    expect(reads("r = a + a")).toEqual(["a", "a"]);
    expect(reads("r = params.reads + params.x.y")).toEqual([
      "params.reads",
      "params.x.y",
    ]);
    expect(reads("r = res.bam")).toEqual(["res.bam"]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Nextflow source, not a template
    expect(reads('r = "x ${a} y ${b.name}"')).toEqual(["a", "b.name"]);
    expect(reads("r = a ? b : (c ?: d)")).toEqual(["a", "b", "c", "d"]);
    expect(reads("r = obj?.p")).toEqual(["obj.p"]);
    // the chain stops at an index, a call and a spread
    expect(reads("r = a.b[i].c")).toEqual(["a.b", "i"]);
    expect(reads("r = a*.name")).toEqual(["a"]);
    expect(reads("r = a.b().c")).toEqual(["a"]);
    expect(reads("if (a) { r = 1 }")).toEqual(["a"]);
    expect(reads("r = r + a")).toEqual(["r", "a"]);
    const [read] = statementVariables(statement("r = params.x")).reads;
    expect(read).toMatchObject({
      name: "params",
      properties: ["x"],
      inClosure: false,
      compoundTarget: false,
    });
    expect(read?.range.line).toBe(1);
    expect(
      statementVariables(statement("r = c.map { v -> v + k }")).reads,
    ).toEqual([
      expect.objectContaining({ name: "c", inClosure: false }),
      expect.objectContaining({ name: "k", inClosure: true }),
    ]);
  });

  it("F-108 LA-27: closure parameters, implicit it, closure- and block-local defs and catch variables are not free", () => {
    expect(reads("r = c.collect { v -> v + k }")).toEqual(["c", "k"]);
    expect(reads("r = c.collect { it + k }")).toEqual(["c", "k"]);
    expect(reads("r = c.collect { -> it + k }")).toEqual(["c", "k"]);
    expect(
      reads("r = c.collect { v -> v.collect { w -> w + v + k } }"),
    ).toEqual(["c", "k"]);
    expect(reads("r = c.collect { v -> def loc = v + k; loc }")).toEqual([
      "c",
      "k",
    ]);
    expect(reads("if (a) { def inner = b; r = inner }")).toEqual(["a", "b"]);
    expect(
      reads("try { r = a } catch (Exception e) { r = e.message }"),
    ).toEqual(["a"]);
    // a name assigned earlier in the same statement is declared for what follows
    expect(reads("if (a) { r = 1 } else { s = r }")).toEqual(["a"]);
    expect(reads("if (c) { def x = a; r = x }")).toEqual(["c", "a"]);
  });

  it("F-108 LA-27: method names, property names, map and named-argument keys are not reads", () => {
    expect(reads("r = compute(a)")).toEqual(["a"]);
    expect(reads("r = foo(a, flag: c)")).toEqual(["a", "c"]);
    expect(reads("r = a.size()")).toEqual(["a"]);
    expect(reads("r = [k: a, (b): 1]")).toEqual(["a", "b"]);
    expect(reads("r = a.b.c")).toEqual(["a.b.c"]);
    expect(reads("r = 'x'")).toEqual([]);
  });

  it("F-108 LA-27: writes are implicit declarations, reassignments, top-level defs, tuple targets and set/tap targets, in first-write order", () => {
    expect(writes("r = a")).toEqual(["r"]);
    expect(writes("def r = a")).toEqual(["r"]);
    expect(writes("def (p, q) = a")).toEqual(["p", "q"]);
    expect(writes("(p, q) = a")).toEqual(["p", "q"]);
    expect(writes("if (a) { r = 1 } else { s = 2; r = 3 }")).toEqual([
      "r",
      "s",
    ]);
    expect(writes("c.map { v -> v }.set { s }")).toEqual(["s"]);
    expect(writes("c.tap { t }.view()")).toEqual(["t"]);
    expect(
      writes("try { r = a } catch (Exception e) { r = e.message }"),
    ).toEqual(["r"]);
    // block- and closure-local names are not writes
    expect(writes("if (a) { def inner = b; r = inner }")).toEqual(["r"]);
    expect(writes("r = c.collect { v -> def loc = v; w = loc }")).toEqual([
      "r",
    ]);
    expect(writes("log.info('x')")).toEqual([]);
    const [def, implicit] = statementVariables(statement("def x = 1")).writes;
    expect(def).toMatchObject({ name: "x", declared: true });
    expect(implicit).toBeUndefined();
    expect(statementVariables(statement("x = 1")).writes[0]?.declared).toBe(
      false,
    );
  });

  it("F-108 LA-27: a compound assignment reads and writes its target; a property or index assignment reads its root only", () => {
    const compound = statementVariables(statement("acc += a"));
    expect(compound.reads.map((r) => [r.name, r.compoundTarget])).toEqual([
      ["a", false],
      ["acc", true],
    ]);
    expect(compound.writes.map((w) => w.name)).toEqual(["acc"]);
    // declared earlier in the statement: not free
    expect(reads("if (c) { def acc = 0; acc += a }")).toEqual(["c", "a"]);
    const prop = statementVariables(statement("acc.prop = v"));
    expect(prop.reads.map(show)).toEqual(["v", "acc.prop"]);
    expect(prop.writes).toEqual([]);
    const index = statementVariables(statement("lst[idx] = e"));
    expect(index.reads.map(show)).toEqual(["e", "lst", "idx"]);
    expect(index.writes).toEqual([]);
    expect(reads("lst << x")).toEqual(["lst", "x"]);
    expect(writes("lst << x")).toEqual([]);
  });

  it("F-108 AR-13: variablesRead and statementVariables agree on every expression statement of the fixtures", () => {
    const here = (path: string) =>
      fileURLToPath(new URL(path, import.meta.url));
    const files = [
      here("../fixtures/main.nf"),
      here("../../../../../tools/oracle/cases/f108-code-nodes/main.nf"),
    ];
    let compared = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const body of workflows(text).values())
        for (const s of body) {
          if (s.kind !== "ExpressionStatement") continue;
          const expression = (s as ExpressionStatement).expression;
          // `x.set { v }` declares v; variablesRead sees it as a read
          if (/\.(set|tap)\s*\{/.test(text.slice(s.range.start, s.range.end)))
            continue;
          expect(
            statementVariables(s).reads.map((r) => [r.name, r.properties]),
            text.slice(s.range.start, s.range.end),
          ).toEqual(
            variablesRead(expression).map((r) => [r.name, r.properties]),
          );
          compared += 1;
        }
    }
    expect(compared).toBeGreaterThan(5);
  });
});
