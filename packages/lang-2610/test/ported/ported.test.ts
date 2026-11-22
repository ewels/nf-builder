// The checked inputs of nf-lang's three parser tests at the pinned commit (see cases.json). Cases decided in the lexer or
// grammar are asserted exactly; the rest must parse here and are handed to the feature that owns the later error.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ParseError,
  parseConfig,
  parseScript,
} from "../../src/parser/parse.ts";

type Lint = { line: number; column: number; message: string };
type PortedCase = {
  id: string;
  file: string;
  upstream: string;
  test: string;
  layer: "lexer" | "parser" | "reparse" | "ast-builder" | "resolve";
  owner?: "F-102" | "F-103" | "F-112";
  producer?: string;
  expect: { ok: true } | ({ ok: false } & ParseError);
  lint: Lint[];
  lintNote?: string;
};
type Manifest = {
  upstream: { tag: string; commit: string };
  cases: PortedCase[];
};

const read = (path: string) =>
  readFileSync(join(import.meta.dirname, path), "utf8");
const manifest = JSON.parse(read("cases.json")) as Manifest;
const upstream = JSON.parse(read("../../upstream.json")) as {
  nextflow: { tag: string; commit: string };
};

const outcomeOf = (c: PortedCase) => {
  const text = read(c.file);
  const outcome = c.file.endsWith(".config")
    ? parseConfig(text)
    : parseScript(text);
  return outcome.ok ? { ok: true } : { ok: false, ...outcome.error };
};
const atGrammar = (c: PortedCase) =>
  c.layer === "lexer" || c.layer === "parser";

describe("ported nf-lang parser cases", () => {
  for (const c of manifest.cases) {
    if (!atGrammar(c)) {
      it(`F-101 ADR-0005: ${c.id} (${c.test}) parses at grammar level; ${c.owner} must report its ${c.layer} error`, () => {
        expect(outcomeOf(c)).toEqual({ ok: true });
      });
    } else if (c.expect.ok) {
      it(`F-101 ADR-0005: ${c.id} (${c.test}) parses`, () => {
        expect(outcomeOf(c)).toEqual({ ok: true });
      });
    } else {
      it(`F-101 LA-30 ADR-0005: ${c.id} (${c.test}) fails at ${c.expect.line}:${c.expect.column} with ${c.expect.message}`, () => {
        expect(outcomeOf(c)).toEqual(c.expect);
      });
    }
  }

  it("F-101: the manifest lists the 90 checked inputs of nf-lang's three parser tests at the pinned commit", () => {
    expect(manifest.upstream.commit).toBe(upstream.nextflow.commit);
    expect(manifest.upstream.tag).toBe(upstream.nextflow.tag);
    const ids = manifest.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const count = (prefix: string) =>
      ids.filter((id) => id.startsWith(prefix)).length;
    expect([
      count("ScriptAstBuilderTest-"),
      count("ConfigAstBuilderTest-"),
      count("AgentParserTest-"),
    ]).toEqual([49, 10, 31]);
    for (const c of manifest.cases) {
      const m =
        /^(script|config)\/parser\/(\w+Test)\.groovy#L\d+-L\d+(,L\d+)?$/.exec(
          c.upstream,
        );
      expect(m?.[2], c.id).toBe(c.id.split("-")[0]);
    }
  });

  it("F-101: every case file is listed and every listed file exists", () => {
    const listed = manifest.cases.map((c) => c.file).sort();
    const onDisk = readdirSync(join(import.meta.dirname, "cases"))
      .map((f) => `cases/${f}`)
      .sort();
    expect(onDisk).toEqual(listed);
  });

  it("F-101 LA-30 ADR-0005: grammar-level errors equal the recorded nextflow lint 26.10.7 errors", () => {
    for (const c of manifest.cases) {
      if (!atGrammar(c)) {
        expect(c.owner, c.id).toBeDefined();
        expect(c.producer, c.id).toBeDefined();
        expect(c.lint.length, c.id).toBeGreaterThan(0);
      } else {
        expect(c.owner, c.id).toBeUndefined();
        if (c.expect.ok) {
          if (!c.lintNote) expect(c.lint, c.id).toEqual([]);
        } else {
          expect(c.lint, c.id).toEqual([
            {
              line: c.expect.line,
              column: c.expect.column,
              message: c.expect.message,
            },
          ]);
        }
      }
    }
  });

  it("F-101: the line-continuation case keeps its CRLF line ends", () => {
    expect(read("cases/ScriptAstBuilderTest-L852.nf")).toContain("\r\n");
  });
});
