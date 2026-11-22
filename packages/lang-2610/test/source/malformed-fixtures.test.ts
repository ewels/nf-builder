import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Unparsed } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseConfigAst, parseScriptAst } from "../../src/ast/index.ts";
import {
  parseConfigSource,
  parseScriptSource,
} from "../../src/source/parse-source.ts";
import { shiftPositions } from "../../src/source/shift.ts";
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

/** An item's own leading and trailing comments lie outside its slice, so a fragment cannot have them. */
const withoutSlots = (item: unknown) => {
  const { leadingComments, trailingComments, ...rest } = item as Record<
    string,
    unknown
  >;
  return rest;
};

describe("F-104 step 2 ADR-0004: the malformed fixtures keep what they cannot model", () => {
  for (const { file, expect: want } of entries) {
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
      // each modelled item, parsed alone as a fragment (with the file's types flag before it) and shifted, is the item
      let types = false;
      for (const item of items) {
        if (item.kind === "Unparsed") continue;
        const slice = text.slice(item.range.start, item.range.end);
        const lineStart = text.lastIndexOf("\n", item.range.start - 1) + 1;
        const prefix = text.slice(lineStart, item.range.start);
        const by = { offset: lineStart, line: item.range.line - 1 };
        if (ast.kind === "Script") {
          const alone = parseScriptAst(prefix + slice, {
            fragment: true,
            typesEnabled: types,
          });
          expect(alone.ok).toBe(true);
          if (alone.ok) {
            expect(withoutSlots(shiftPositions(alone.ast.body[0], by))).toEqual(
              withoutSlots(item),
            );
            types = alone.ast.typesEnabled;
          }
        } else {
          const alone = parseConfigAst(prefix + slice);
          expect(alone.ok).toBe(true);
          if (alone.ok)
            expect(
              withoutSlots(shiftPositions(alone.ast.statements[0], by)),
            ).toEqual(withoutSlots(item));
        }
      }
      expect(r.status).toBe(unparsed.length > 0 ? "partial" : "modelled");
    });
  }

  it("F-104 step 2: every fixture in fixtures.yaml is tested", () => {
    const files = readdirSync(dir).filter((f) => f !== "fixtures.yaml");
    expect(entries.map((e) => e.file).sort()).toEqual(files.sort());
  });
});
