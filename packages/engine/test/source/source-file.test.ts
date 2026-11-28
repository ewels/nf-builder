import type {
  ParseProblem,
  Range,
  ScriptAst,
  ScriptSourceParse,
  SourceParser,
} from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { installedPackVersions } from "../../src/packs";
import { topLevelItems } from "../../src/source/items";
import { loadParser } from "../../src/source/parser";
import { printSourceFile } from "../../src/source/print";
import { createSourceFile } from "../../src/source/source-file";
import { verifyModel } from "../../src/source/verify";

let parser: SourceParser;
beforeAll(async () => {
  parser = await loadParser(installedPackVersions()[0] as string);
});

const good = (name: string) =>
  `process ${name} {\n    script:\n    'echo'\n}\n`;
const bad = (name: string) =>
  `process ${name} {\n    script:\n    def a = = 1\n    'echo'\n}\n`;

describe("F-104 AR-01 IO-14: createSourceFile", () => {
  it("F-104 AR-01: createSourceFile holds path, text, language, parse status, AST and comment map", () => {
    const script = createSourceFile("main.nf", `// hi\n${good("A")}`, parser);
    expect(script).toMatchObject({
      path: "main.nf",
      language: "nextflow",
      status: "modelled",
      problems: [],
    });
    expect(script.ast?.kind).toBe("Script");
    expect(script.comments.map((c) => c.text)).toEqual(["// hi"]);

    const config = createSourceFile(
      "nextflow.config",
      "docker.enabled = true\n",
      parser,
    );
    expect(config).toMatchObject({ language: "config", status: "modelled" });
    expect(config.ast?.kind).toBe("ConfigFile");

    const json = createSourceFile("a.json", "{ not parsed }", parser);
    expect(json).toMatchObject({
      language: "json",
      status: "plain",
      ast: null,
      problems: [],
      comments: [],
    });

    const partial = createSourceFile("main.nf", good("A") + bad("B"), parser);
    expect(partial.status).toBe("partial");
    expect(topLevelItems(partial).map((i) => i.kind)).toEqual([
      "Process",
      "Unparsed",
    ]);

    const verbatim = createSourceFile("main.nf", bad("ONLY"), parser);
    expect(verbatim).toMatchObject({ status: "verbatim", ast: null });
    expect(verbatim.problems.length).toBeGreaterThan(0);
    expect(topLevelItems(verbatim)).toEqual([]);
  });

  it("F-104 IO-14 ADR-0004: a stray closing brace, which nextflow lint accepts, leaves the file modelled and prints back", () => {
    for (const [path, text] of [
      ["main.nf", "workflow {\n}\n}\n"],
      ["nextflow.config", "a = 1\n}\nb = 2\n"],
    ] as const) {
      const f = createSourceFile(path, text, parser);
      expect(f.status, path).toBe("modelled");
      expect(f.problems, path).toEqual([]);
      expect(verifyModel(f), path).toEqual([]);
      expect(printSourceFile(f)).toBe(text);
    }
  });

  it("F-104 IO-14: createSourceFile never throws, even when the pack parser does", () => {
    const throwing: SourceParser = {
      printer: {} as SourceParser["printer"],
      configPrinter: {} as SourceParser["configPrinter"],
      parseScript: () => {
        throw new Error("boom");
      },
      parseConfig: () => {
        throw new Error("boom");
      },
    };
    for (const path of ["main.nf", "nextflow.config"]) {
      const f = createSourceFile(path, "x = 1\n", throwing);
      expect(f.status).toBe("verbatim");
      expect(f.ast).toBeNull();
      expect(f.problems.map((p) => p.source)).toEqual(["internal"]);
      expect(printSourceFile(f)).toBe("x = 1\n");
    }
  });

  it("F-104 IO-14: a model that doesn't account for its text is downgraded to verbatim", () => {
    const range = (start: number, end: number): Range => ({
      start,
      end,
      line: 1,
      column: start + 1,
      endLine: 1,
      endColumn: end + 1,
    });
    const text = "workflow {\n}\nprintln 1\n";
    const item = (start: number, end: number) => ({
      kind: "Unparsed" as const,
      range: range(start, end),
      text: text.slice(start, end),
      head: null,
      problems: [] as ParseProblem[],
    });
    const ast = (body: ScriptAst["body"]): ScriptAst => ({
      kind: "Script",
      range: range(0, text.length),
      shebang: null,
      body,
      comments: [],
      typesEnabled: false,
    });
    const stubFor = (body: ScriptAst["body"]): SourceParser => ({
      printer: {} as SourceParser["printer"],
      configPrinter: {} as SourceParser["configPrinter"],
      parseScript: (): ScriptSourceParse => ({
        status: "partial",
        ast: ast(body),
        problems: [],
      }),
      parseConfig: () => ({ status: "verbatim", ast: null, problems: [] }),
    });
    const overlapping = createSourceFile(
      "main.nf",
      text,
      stubFor([item(0, 12), item(5, 13)]),
    );
    const gap = createSourceFile("main.nf", text, stubFor([item(0, 13)]));
    const wrongText = createSourceFile(
      "main.nf",
      text,
      stubFor([{ ...item(0, 13), text: "nope" }, item(13, text.length - 1)]),
    );
    for (const f of [overlapping, gap, wrongText]) {
      expect(f.status).toBe("verbatim");
      expect(f.ast).toBeNull();
      expect(f.problems.some((p) => p.source === "internal")).toBe(true);
      expect(printSourceFile(f)).toBe(text);
    }
    // the accepted shape for comparison: items covering all the code
    const fine = createSourceFile(
      "main.nf",
      text,
      stubFor([item(0, 13), item(13, text.length - 1)]),
    );
    expect(fine.status).toBe("partial");
    expect(verifyModel(fine)).toEqual([]);
  });

  it("F-104 IO-14: hostile input never throws and prints back exactly", () => {
    const alphabet = [
      ..."{}()[]'\"/*$\\#\n\r ;.=-?:",
      ..."process workflow include params def x A 1 ".split(" "),
    ];
    let seed = 99;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const texts: string[] = [
      "",
      "﻿process A {\n}\n",
      "\u0000",
      "\ud800",
      "\udc00 x",
      "a \ud83d b",
      "{".repeat(4_000),
      `process A {\n${"(".repeat(4_000)}\n`,
    ];
    for (let k = 0; k < 200; k++) {
      let t = "";
      const n = next() % 60;
      for (let j = 0; j < n; j++) t += alphabet[next() % alphabet.length];
      texts.push(t);
    }
    for (const text of texts) {
      for (const path of ["main.nf", "nextflow.config", "x.json"]) {
        const f = createSourceFile(path, text, parser);
        expect(printSourceFile(f) === text, JSON.stringify(text)).toBe(true);
        expect(verifyModel(f), JSON.stringify(text)).toEqual([]);
      }
    }
  }, 60_000);
});
