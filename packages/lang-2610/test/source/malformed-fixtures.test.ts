import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Unparsed } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  parseConfigSource,
  parseScriptSource,
} from "../../src/source/parse-source.ts";
import { labelOf } from "./labels.ts";
import { checkTiling } from "./tiling.ts";

const dir = fileURLToPath(
  new URL("../../../../tools/corpus/fixtures/", import.meta.url),
);
interface Entry {
  file: string;
  expect: { wholeFile?: boolean; unparsed?: string[]; modelled?: string[] };
}
const entries = (
  parse(readFileSync(`${dir}fixtures.yaml`, "utf8")) as { fixtures: Entry[] }
).fixtures;

// The chunked path (F-104 task 3b) isolates these; the whole-file path alone cannot.
const CHUNKED = new Set([
  "bad-declaration.nf",
  "unclosed-brace.nf",
  "bad-config-block.config",
  "unclosed-config-block.config",
]);

describe("F-104 step 2 ADR-0004: the malformed fixtures keep what they cannot model", () => {
  for (const { file, expect: want } of entries) {
    if (CHUNKED.has(file)) continue;
    const label = want.wholeFile
      ? "the whole file"
      : (want.unparsed ?? []).join(", ") || "nothing";
    it(`F-104 step 2 ADR-0004: ${file} keeps ${label} as text and models ${(want.modelled ?? []).join(", ") || "nothing"}`, () => {
      const text = readFileSync(`${dir}${file}`, "utf8");
      const r = file.endsWith(".config")
        ? parseConfigSource(text)
        : parseScriptSource(text);
      if (want.wholeFile) {
        expect(r.status).toBe("verbatim");
        expect(r.ast).toBeNull();
        return;
      }
      const ast = r.ast;
      expect(ast).not.toBeNull();
      if (!ast) return;
      const items = ast.kind === "Script" ? ast.body : ast.statements;
      const unparsed = items.filter(
        (i): i is Unparsed => i.kind === "Unparsed",
      );
      expect(unparsed.map((i) => labelOf(i, text))).toEqual(
        want.unparsed ?? [],
      );
      expect(
        items.filter((i) => i.kind !== "Unparsed").map((i) => labelOf(i, text)),
      ).toEqual(want.modelled ?? []);
      for (const u of unparsed) {
        expect(u.text).toBe(text.slice(u.range.start, u.range.end));
        expect(u.problems.length).toBeGreaterThan(0);
      }
      expect(checkTiling(text, ast)).toEqual([]);
      expect(r.status).toBe(unparsed.length > 0 ? "partial" : "modelled");
    });
  }

  it("F-104 step 2: every fixture in fixtures.yaml is tested", () => {
    const tested = entries.filter((e) => !CHUNKED.has(e.file)).length;
    expect(tested + CHUNKED.size).toBe(entries.length);
    expect(entries).toHaveLength(9);
  });
});
