import { describe, expect, it } from "vitest";
import {
  type ConfigAst,
  type ConfigItem,
  childNodes,
  type Range,
  SCRIPT_NODE_KINDS,
  type ScriptAst,
  type ScriptItem,
  type SourceFile,
  type Unparsed,
} from "../src/index.ts";

const range: Range = {
  start: 0,
  end: 3,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 4,
};
const unparsed: Unparsed = {
  kind: "Unparsed",
  range,
  text: "foo",
  head: { keyword: "process", name: "FOO" },
  problems: [
    {
      source: "parser",
      message: "x",
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 2,
    },
  ],
};
const scriptAst: ScriptAst = {
  kind: "Script",
  range,
  shebang: null,
  body: [unparsed],
  comments: [],
  typesEnabled: false,
};
const configAst: ConfigAst = {
  kind: "ConfigFile",
  range,
  statements: [unparsed],
  comments: [],
};

describe("F-104 AR-01: the SourceFile model", () => {
  it("F-104 AR-01: SourceFile carries path, text, language, parse status, AST and comment map", () => {
    const script = {
      path: "main.nf",
      text: "foo",
      language: "nextflow",
      status: "partial",
      ast: scriptAst,
      problems: [],
      comments: [],
    } satisfies SourceFile;
    const config = {
      path: "nextflow.config",
      text: "foo",
      language: "config",
      status: "partial",
      ast: configAst,
      problems: [],
      comments: [],
    } satisfies SourceFile;
    const verbatim = {
      path: "main.nf",
      text: "foo",
      language: "nextflow",
      status: "verbatim",
      ast: null,
      problems: [],
      comments: [],
    } satisfies SourceFile;
    const plain = {
      path: "a.json",
      text: "{}",
      language: "json",
      status: "plain",
      ast: null,
      problems: [],
      comments: [],
    } satisfies SourceFile;
    // @ts-expect-error a plain file has no AST
    const badPlain: SourceFile = { ...plain, ast: scriptAst };
    // @ts-expect-error a script file cannot hold a config AST
    const badScript: SourceFile = { ...script, ast: configAst };
    // @ts-expect-error a plain file's status is plain
    const badStatus: SourceFile = { ...plain, status: "modelled" };
    expect([script, config, verbatim, plain].map((f) => f.language)).toEqual([
      "nextflow",
      "config",
      "nextflow",
      "json",
    ]);
    expect([badPlain, badScript, badStatus]).toHaveLength(3);
  });

  it("F-104 ADR-0004: Unparsed is a script item and a top-level config item, and a node kind", () => {
    const asScript: ScriptItem = unparsed;
    const asConfig: ConfigItem = unparsed;
    expect(asScript.kind).toBe("Unparsed");
    expect(asConfig.kind).toBe("Unparsed");
    expect(SCRIPT_NODE_KINDS).toContain("Unparsed");
    expect(childNodes(unparsed)).toEqual([]);
  });
});
