import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PositionIndex } from "../../src/ast/positions.ts";
import { ConfigLexer } from "../../src/generated/ConfigLexer.ts";
import { ScriptLexer } from "../../src/generated/ScriptLexer.ts";
import {
  type Chunk,
  type Grammar,
  KEYWORDS,
  prescan,
  SCRIPT_STARTERS,
  scanHead,
} from "../../src/source/prescan.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const chunksOf = (text: string, grammar: Grammar = "script") =>
  prescan(text, grammar).chunks;
const chunkTexts = (text: string, grammar: Grammar = "script") =>
  chunksOf(text, grammar).map((c) => text.slice(c.start, c.end));
const heads = (text: string, grammar: Grammar = "script") =>
  chunksOf(text, grammar).map((c) =>
    c.head ? `${c.head.keyword} ${c.head.name ?? ""}`.trim() : null,
  );

function tiles(text: string, chunks: readonly Chunk[]): void {
  expect(chunks.length).toBeGreaterThan(0);
  let at = 0;
  for (const c of chunks) {
    expect(c.start).toBe(at);
    expect(c.end).toBeGreaterThanOrEqual(c.start);
    if (c.start > 0) expect(text[c.start - 1]).toBe("\n");
    expect(c.codeStart).toBeGreaterThanOrEqual(c.start);
    expect(c.codeStart).toBeLessThanOrEqual(c.end);
    at = c.end;
  }
  expect(at).toBe(text.length);
}

describe("F-104 step 2 ADR-0004: the pre-scanner splits a file into top-level chunks", () => {
  it("F-104 step 2 ADR-0004: each kind of script declaration starts a chunk with its head", () => {
    const text = [
      "nextflow.enable.types = true",
      "include { A } from './a'",
      "include { B } from './b'",
      "import java.util.List",
      "params.input = 'x'",
      "params {",
      "    input: String",
      "}",
      "record Sample {",
      "    id: String",
      "}",
      "enum Colour { RED }",
      "agent BOT {",
      "}",
      "def helper(x) {",
      "    return x",
      "}",
      "String legacy(String x) {",
      "    x",
      "}",
      "List<String> typed(Map<String, Integer> m) {",
      "    null",
      "}",
      "process FOO {",
      "    script:",
      "    'echo hi'",
      "}",
      "workflow SUB {",
      "}",
      "workflow {",
      "    FOO()",
      "}",
      "output {",
      "}",
      "",
    ].join("\n");
    expect(heads(text)).toEqual([
      "featureFlag nextflow.enable.types",
      "include",
      "include",
      "import java.util.List",
      "param params.input",
      "params",
      "record Sample",
      "enum Colour",
      "agent BOT",
      "function helper",
      "function legacy",
      "function typed",
      "process FOO",
      "workflow SUB",
      "workflow",
      "output",
    ]);
    const parts = chunkTexts(text);
    expect(parts.join("")).toBe(text);
    expect(parts[5]).toBe("params {\n    input: String\n}\n");
    expect(parts[12]).toBe("process FOO {\n    script:\n    'echo hi'\n}\n");
  });

  it("F-104 step 2: leading comments and blank lines go with the next declaration; a same-line trailing comment stays", () => {
    const text = [
      "process A {",
      "} // end",
      "",
      "/** Docs for B. */",
      "// plain",
      "process B {",
      "}",
      "",
    ].join("\n");
    const parts = chunkTexts(text);
    expect(parts).toEqual([
      "process A {\n} // end\n",
      "\n/** Docs for B. */\n// plain\nprocess B {\n}\n",
    ]);
    const second = chunksOf(text)[1] as Chunk;
    expect(second.codeStart).toBe(text.indexOf("process B"));
    expect(
      second.leadingComments.map((c) => [c.kind, c.text, c.ownLine]),
    ).toEqual([
      ["doc", "/** Docs for B. */", true],
      ["line", "// plain", true],
    ]);
    expect(second.leadingComments[0]?.range).toMatchObject({
      start: text.indexOf("/**"),
      line: 4,
      column: 1,
      endLine: 4,
      endColumn: 19,
    });
  });

  it("F-104 step 2: braces inside strings don't count", () => {
    const bodies = [
      "'}'",
      '"{"',
      "'''}\n}'''",
      '"""}"""',
      '"""a""""',
      "'\\''",
      '"a\\"}"',
    ];
    for (const body of bodies) {
      const text = `process A {\n  x = ${body}\n}\nprocess B {\n}\n`;
      expect(heads(text), body).toEqual(["process A", "process B"]);
    }
    // four quotes: the last three close, the first is content
    const four = '__ = """a""""\nprocess B {\n}\n';
    expect(chunkTexts(four)).toEqual(['__ = """a""""\n', "process B {\n}\n"]);
  });

  it("F-104 step 2: comments carry F-102's kind, text without trailing whitespace and ownLine", () => {
    const text = "// a  \nx = 1 /* b */ // c\n/**/\nprocess P {\n}\n";
    expect(
      chunksOf(text)[0]?.leadingComments.map((c) => [
        c.kind,
        c.text,
        c.ownLine,
      ]),
    ).toEqual([["line", "// a", true]]);
    const second = chunksOf(text)[1];
    expect(second?.leadingComments.map((c) => [c.kind, c.text])).toEqual([
      ["doc", "/**/"],
    ]);
  });

  it("F-104 step 2: braces inside comments don't count", () => {
    const text = [
      "process A {",
      "  // }",
      "  /* { */",
      "  /** } */",
      "}",
      "process B {",
      "}",
      "",
    ].join("\n");
    expect(heads(text)).toEqual(["process A", "process B"]);
    expect(prescan(text, "script").open).toEqual([]);
  });

  it("F-104 step 2: GString interpolation is balanced inside strings", () => {
    const bodies = [
      '"${ xs.collect { it } }"',
      '"${ "}" }"',
      '"""${ x ? \'{\' : \'}\' }"""',
      '"$a.b }"',
      '"\\${x} }"',
    ];
    for (const body of bodies) {
      const text = `process A {\n  x = ${body}\n}\nprocess B {\n}\n`;
      expect(heads(text), body).toEqual(["process A", "process B"]);
    }
  });

  it("F-104 step 2: slashy strings follow the lexer's regex rule", () => {
    const slashy = "process A {\n  x = /a}b/\n}\nprocess B {\n}\n";
    expect(heads(slashy)).toEqual(["process A", "process B"]);
    // after an identifier a slash is division, so the brace counts
    const division = "process A {\n  x = a / b }\n}\nprocess B {\n}\n";
    expect(prescan(division, "script").open).toEqual([]);
    expect(heads(division)).toEqual(["process A", "process B"]);
    // at the start of a line a slash starts a slashy string
    const lineStart = "process A {\n  x = 1\n  /}/\n}\nprocess B {\n}\n";
    expect(heads(lineStart)).toEqual(["process A", "process B"]);
    // `//` and `/*` are comments
    const comments =
      "process A {\n  x = 1 // }\n  /* } */\n}\nprocess B {\n}\n";
    expect(heads(comments)).toEqual(["process A", "process B"]);
    // `/foo$bar/` is not slashy (the lexer sees `$` before a letter), so the closing brace after it counts
    const dollar = "process A {\n  x = /foo$bar/ }\n";
    expect(prescan(dollar, "script").open).toEqual([]);
    // multi-line slashy
    const multi = "process A {\n  x = /a\n}\nb/\n}\nprocess B {\n}\n";
    expect(heads(multi)).toEqual(["process A", "process B"]);
    // after `}` and `)` a slash is division
    const afterClose = "process A {\n  x = (1) / 2 / 3\n}\nprocess B {\n}\n";
    expect(heads(afterClose)).toEqual(["process A", "process B"]);
  });

  it("F-104 step 2: a shebang is a comment only at offset 0 and a line starting with # never starts a chunk", () => {
    const text = "#!/usr/bin/env nextflow\n#!second\nprocess A {\n}\n";
    const [first] = chunksOf(text);
    expect(first?.leadingComments.map((c) => [c.kind, c.text])).toEqual([
      ["shebang", "#!/usr/bin/env nextflow\n#!second"],
    ]);
    expect(first?.head).toEqual({ keyword: "process", name: "A" });
    // a later `#!` is an ordinary character, not a comment: the brace after it counts
    const later = "process A {\n}\n#! }\nprocess B {\n}\n";
    expect(heads(later)).toEqual(["process A", "process B"]);
    expect(chunkTexts(later)[0]).toBe("process A {\n}\n#! }\n");
    // a `#` line right after a closing brace stays with it
    const hash = "process A {\n}\n# x\nprocess B {\n}\n";
    expect(chunkTexts(hash)).toEqual([
      "process A {\n}\n# x\n",
      "process B {\n}\n",
    ]);
  });

  it("F-104 step 2: CRLF text gives the same chunks and heads at the same lines; a lone CR is never a chunk start", () => {
    const lf = "process A {\n  x = 1\n}\n// c\nprocess B {\n}\n";
    const crlf = lf.replaceAll("\n", "\r\n");
    const a = chunksOf(lf);
    const b = chunksOf(crlf);
    expect(b.map((c) => [c.line, c.head])).toEqual(
      a.map((c) => [c.line, c.head]),
    );
    expect(b.map((c) => crlf.slice(c.start, c.end))).toEqual(
      a.map((c) => lf.slice(c.start, c.end).replaceAll("\n", "\r\n")),
    );
    tiles(crlf, b);
    const lone = "process A {\r}\rprocess B {\r}\r";
    expect(chunkTexts(lone)).toEqual([lone]);
    const mixed = "process A {\r}\r\nprocess B {\r}\r";
    expect(chunkTexts(mixed)).toEqual([
      "process A {\r}\r\n",
      "process B {\r}\r",
    ]);
  });

  it("F-104 step 2: a line escape joins two lines", () => {
    const text = "foo \\\nprocess X {\n}\n";
    expect(chunkTexts(text)).toEqual([text]);
    const crlf = "foo \\\r\nprocess X {\r\n}\r\n";
    expect(chunkTexts(crlf)).toEqual([crlf]);
  });

  it("F-104 step 2: continuation lines never start a chunk", () => {
    const after = ["a +", "a ?:", "a =", "a,", "a ->", "x in", "x instanceof"];
    for (const first of after) {
      const text = `${first}\ndef b = 1\n`;
      expect(chunkTexts(text), first).toEqual([text]);
    }
    const before = [
      ".foo()",
      "?.foo()",
      "?: 1",
      "else {",
      "catch (e) {",
      "* 2",
      "&& x",
      "== 2",
      "{ it }",
    ];
    for (const second of before) {
      const text = `foo {\n}\n${second}\n`;
      expect(chunkTexts(text), second).toEqual([text]);
    }
    const afterDef = "a = 1\ndef b = 1\n";
    expect(chunkTexts(afterDef)).toEqual(["a = 1\n", "def b = 1\n"]);
    const wildcard = "import java.util.*\nimport java.io.File\n";
    expect(chunkTexts(wildcard)).toHaveLength(2);
  });

  it("F-104 step 2: a declaration not at line start does not start a chunk", () => {
    const text = "foo(); process X {\n}\n";
    expect(chunkTexts(text)).toEqual([text]);
  });

  it("F-104 step 2: keywords inside longer words or followed by a dot are not starters", () => {
    expect(chunkTexts("a = 1\nprocesses {\n}\n")).toHaveLength(1);
    expect(chunkTexts("a = 1\nworkflowFoo\n")).toHaveLength(1);
    // workflow.onComplete is not a starter, but the line before it closes a brace, so S1 still splits
    const hook = "process A {\n}\nworkflow.onComplete {\n}\n";
    expect(chunkTexts(hook)).toEqual([
      "process A {\n}\n",
      "workflow.onComplete {\n}\n",
    ]);
    expect(heads(hook)).toEqual(["process A", null]);
    expect(chunkTexts("a = 1\nworkflow.onComplete {\n}\n")).toHaveLength(1);
    expect(chunkTexts("a = 1\nparams.x = 1\n")).toHaveLength(2);
    expect(chunkTexts("a = 1\nnextflow.enable.types = true\n")).toHaveLength(2);
    expect(heads("nextflow.enable.types\n")).toEqual([null]);
  });

  it("F-104 step 2 ADR-0004: an unclosed brace runs its chunk to the end of the text", () => {
    const text = "process A {\n}\nworkflow {\n  A()\n\nprocess C {\n}\n";
    const scan = prescan(text, "script");
    expect(scan.chunks.map((c) => text.slice(c.start, c.end))).toEqual([
      "process A {\n}\n",
      "workflow {\n  A()\n\nprocess C {\n}\n",
    ]);
    expect(scan.open.at(-1)).toBe("{");
    expect(scan.open).toEqual(["{"]);
  });

  it("F-104 step 2: unterminated strings and comments are bounded as the lexer would", () => {
    // 'abc ends at the newline
    const sq = "a = 'abc\nprocess B {\n}\n";
    expect(heads(sq)).toEqual([null, "process B"]);
    // triple quotes and block comments run to the end of the text
    expect(chunkTexts('a = """abc\nprocess B {\n}\n')).toHaveLength(1);
    expect(prescan('a = """abc\n}\n', "script").open).toEqual(["string"]);
    expect(prescan("a = '''abc\n}\n", "script").open).toEqual(["string"]);
    expect(prescan("x = 1\n/* abc\nprocess B {\n}\n", "script").open).toEqual([
      "comment",
    ]);
    // S3: an own-line unterminated /* splits before it
    const s3 = "process A {\n}\n\n/* truncated\nprocess B {\n}\n";
    expect(chunkTexts(s3)).toEqual([
      "process A {\n}\n",
      "\n/* truncated\nprocess B {\n}\n",
    ]);
    const comment = chunksOf(s3)[1] as Chunk;
    expect(comment.head).toBeNull();
    expect(comment.codeStart).toBe(comment.end);
    expect(comment.leadingComments.map((c) => c.kind)).toEqual(["block"]);
    // not at depth 0: no split
    expect(chunkTexts("process A {\n/* x\n}\n")).toHaveLength(1);
    // extra closers are ignored without throwing
    expect(() => prescan("} ) ] }\nprocess A {\n}\n", "script")).not.toThrow();
    expect(heads("} ) ] }\nprocess A {\n}\nprocess B {\n  foo(]\n}\n")).toEqual(
      [null, "process A", "process B"],
    );
    // a dq string ends at the newline too
    expect(heads('a = "abc\nprocess B {\n}\n')).toEqual([null, "process B"]);
  });

  it("F-104 step 2: config statements are chunks named assign PATH and block NAME", () => {
    const text = [
      "// settings",
      "params.outdir = 'results'",
      "docker.enabled = true",
      "process {",
      "    cpus = 1",
      "    withName: FOO {",
      "        memory = '1 GB'",
      "    }",
      "}",
      "profiles {",
      "    test { params.x = 1 }",
      "}",
      "'foo-bar' {",
      "    a = 1",
      "}",
      "plugins {",
      "    id 'nf-schema'",
      "}",
      "includeConfig 'conf/base.config'",
      "x = [",
      "    'a',",
      "    'b'",
      "]",
      "y = { ->",
      "    1",
      "}",
      "z = '''",
      "process Q {",
      "'''",
      "w = a ?:",
      "    b",
      "v =",
      "    1",
      "if (x) {",
      "}",
      "def q = 1",
      "",
    ].join("\n");
    expect(heads(text, "config")).toEqual([
      "assign params.outdir",
      "assign docker.enabled",
      "block process",
      "block profiles",
      "block foo-bar",
      "block plugins",
      "includeConfig",
      "assign x",
      "assign y",
      "assign z",
      "assign w",
      "assign v",
      "invalid",
      "invalid",
    ]);
    const parts = chunkTexts(text, "config");
    expect(parts[0]).toBe("// settings\nparams.outdir = 'results'\n");
    expect(parts.join("")).toBe(text);
    expect(heads("try {\n}\n", "config")).toEqual(["invalid"]);
    expect(heads("a.b.c = 1\n", "config")).toEqual(["assign a.b.c"]);
  });

  it("F-104 step 2: identifiers follow Java rules and columns count code points", () => {
    expect(heads("process Ünïcødé {\n}\n")).toEqual(["process Ünïcødé"]);
    const text = "/* \u{1d400}\u{1d400} */ /* c */\nprocess X {\n}\n";
    const [chunk] = chunksOf(text);
    const second = chunk?.leadingComments[1];
    expect(second?.text).toBe("/* c */");
    const index = new PositionIndex(text);
    const cp = (offset: number) => [...text.slice(0, offset)].length;
    expect(second?.range).toEqual(
      index.range(cp(second?.range.start ?? 0), cp(second?.range.end ?? 0)),
    );
    expect(second?.range.column).toBe(10);
    // comments are not code, so a comment after a comment is still on its own line (F-102's rule)
    expect(second?.ownLine).toBe(true);
  });

  it("F-104 step 2: chunks tile the text and start at line starts, for every AST fixture and malformed fixture", () => {
    const files: { path: string; grammar: Grammar }[] = [];
    const walk = (dir: string, ext: string, grammar: Grammar) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, ext, grammar);
        else if (name.endsWith(ext)) files.push({ path, grammar });
      }
    };
    walk(here("../ast/fixtures"), ".nf", "script");
    walk(
      here("../../../../tools/oracle/cases/config-constructs"),
      ".config",
      "config",
    );
    walk(here("../../../../tools/corpus/fixtures"), ".nf", "script");
    walk(here("../../../../tools/corpus/fixtures"), ".config", "config");
    expect(files.length).toBeGreaterThan(60);
    for (const { path, grammar } of files) {
      const text = readFileSync(path, "utf8");
      tiles(text, chunksOf(text, grammar));
    }
  });

  it("F-104 step 2 ADR-0004: the malformed fixtures split where the fixture file says", () => {
    const fixture = (name: string) =>
      readFileSync(here(`../../../../tools/corpus/fixtures/${name}`), "utf8");
    expect(heads(fixture("bad-declaration.nf"))).toEqual([
      "process FIRST",
      "process SECOND",
      "workflow",
    ]);
    expect(heads(fixture("unclosed-brace.nf"))).toEqual([
      "process SAY_HELLO",
      "workflow",
    ]);
    expect(heads(fixture("unclosed-comment.nf"))).toEqual([null, null]);
    expect(heads(fixture("bad-config-block.config"), "config")).toEqual([
      "assign docker.enabled",
      "block process",
      "assign params.outdir",
    ]);
    expect(heads(fixture("unclosed-config-block.config"), "config")).toEqual([
      "assign params.outdir",
      "block profiles",
    ]);
  });

  it("F-104 IO-14: the pre-scanner never throws and stays linear on hostile input", () => {
    const alphabet = [..."{}()[]'\"/*$\\#\n\r abcdef;.=-?:"];
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let k = 0; k < 300; k++) {
      let text = "";
      const length = next() % 80;
      for (let j = 0; j < length; j++)
        text += alphabet[next() % alphabet.length];
      for (const grammar of ["script", "config"] as const) {
        const { chunks } = prescan(text, grammar);
        tiles(text, chunks);
      }
    }
    for (const text of ["\ud800", "\udc00x", "﻿", "\0", "", "\u{1d400}"])
      tiles(text, chunksOf(text));
    const nested = "{".repeat(200_000);
    expect(prescan(nested, "script").open).toHaveLength(200_000);
    const nestedParens = `process A {\n${"(".repeat(200_000)}\n`;
    expect(chunksOf(nestedParens)).toHaveLength(1);
    const includes = "include { A } from './a'\n".repeat(40_000);
    expect(includes.length).toBeGreaterThan(900_000);
    expect(chunksOf(includes)).toHaveLength(40_000);
    const slashes = "x = /a\n".repeat(100_000);
    expect(() => prescan(slashes, "script")).not.toThrow();
    const comments = "/**/ ".repeat(200_000);
    expect(chunksOf(comments)[0]?.leadingComments).toHaveLength(200_000);
  });

  it("F-104 LA-02: the script starter keywords are lexer keywords of the 26.10 grammar", () => {
    const literals = new Set(
      ScriptLexer.literalNames.filter((x) => x !== null),
    );
    for (const word of SCRIPT_STARTERS)
      expect(literals.has(`'${word}'`), word).toBe(true);
  });

  it("F-104 LA-02: the keyword lists match the lexers' keyword literals", () => {
    const words = (names: readonly (string | null)[]) =>
      names
        .filter((x): x is string => x !== null && /^'[A-Za-z]+'$/.test(x))
        .map((x) => x.slice(1, -1))
        .filter((x) => x !== "null")
        .sort();
    expect([...KEYWORDS.script].sort()).toEqual(
      words(ScriptLexer.literalNames),
    );
    expect([...KEYWORDS.config].sort()).toEqual(
      words(ConfigLexer.literalNames),
    );
  });

  it("F-104 step 2: scanHead reads a head from any offset", () => {
    expect(scanHead("x\nprocess A {", 2, "script")).toEqual({
      keyword: "process",
      name: "A",
    });
    expect(scanHead("process {", 0, "script")).toEqual({
      keyword: "process",
      name: null,
    });
    expect(scanHead("foo()", 0, "script")).toBeNull();
    expect(scanHead("a = ", 0, "config")).toEqual({
      keyword: "assign",
      name: "a",
    });
  });
});
