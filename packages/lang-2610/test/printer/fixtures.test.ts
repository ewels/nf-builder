// Printer fixtures (F-110, ADR 0005, LA-45), listed in fixtures.json: the printer must print each input as
// `nextflow lint -format` formats it (formatted*/, written by `pnpm oracle --write-format`), except where the manifest
// records a known difference; there printed*/ holds what the printer prints, and the oracle checks it is a fixed point
// with no lint error.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Declaration } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import {
  createLayout,
  printDeclaration,
  printScript,
} from "../../src/printer/index.ts";
import { commentTexts } from "./comment-texts.ts";
import { lineDiff } from "./line-diff.ts";

type Tree = {
  name: string;
  input: string | null;
  formatted: string;
  printed: string;
};
type Entry = {
  tree: string;
  path: string;
  kind: "parsed" | "support" | "synthesised" | "edited";
  knownDifference?: string;
  /** The lines (1-based) where printed and formatted differ: what the known difference changes and nothing else. */
  differingLines?: { formatted: number[]; printed: number[] };
};
type Manifest = {
  trees: Tree[];
  knownDifferences: Record<string, string>;
  files: Entry[];
};

const here = import.meta.dirname;
const manifest = JSON.parse(
  readFileSync(join(here, "fixtures.json"), "utf8"),
) as Manifest;
const trees = new Map(manifest.trees.map((t) => [t.name, t]));
const dirOf = (tree: string, key: "input" | "formatted" | "printed") =>
  resolve(here, (trees.get(tree) as Tree)[key] as string);
const read = (
  tree: string,
  key: "input" | "formatted" | "printed",
  path: string,
) => readFileSync(join(dirOf(tree, key), path), "utf8");

function print(text: string) {
  const parsed = parseScriptAst(text);
  expect(parsed.ok && parsed.errors).toEqual([]);
  if (!parsed.ok) throw new Error("parse failed");
  return {
    ...printScript(parsed.ast, { layout: createLayout(text) }),
    ast: parsed.ast,
  };
}

const printable = manifest.files.filter(
  (f) => f.kind === "parsed" || f.kind === "support",
);

describe("printer fixtures", () => {
  for (const f of printable) {
    const label = `${f.tree}/${f.path}`;
    const input = read(f.tree, "input", f.path);
    const formatted = read(f.tree, "formatted", f.path);

    if (!f.knownDifference) {
      it(`F-110 step 1 LA-45 ADR-0005: ${label} prints as nextflow lint -format formats it`, () => {
        const result = print(input);
        expect(result.text).toBe(formatted);
        expect(result.missingComments).toEqual([]);
      });
    } else {
      it(`F-110 step 1 ADR-0005: ${label} differs from lint -format only as ${f.knownDifference} says`, async () => {
        const result = print(input);
        await expect(result.text).toMatchFileSnapshot(
          join(dirOf(f.tree, "printed"), f.path),
        );
        // a known difference that no longer differs must be removed from the manifest
        expect(result.text).not.toBe(formatted);
        expect(lineDiff(formatted, result.text)).toEqual(f.differingLines);
        expect(result.missingComments).toEqual([]);
      });
    }

    // what the oracle's fixed-point check runs on: formatted/, overlaid with printed/
    const printedPath = join(dirOf(f.tree, "printed"), f.path);
    const expected =
      f.knownDifference && existsSync(printedPath)
        ? readFileSync(printedPath, "utf8")
        : formatted;

    it(`F-110 LA-45: printing ${label} again changes nothing`, () => {
      expect(print(expected).text).toBe(expected);
    });

    it(`F-110 LA-45: ${label} keeps every comment`, () => {
      expect(commentTexts(expected)).toEqual(commentTexts(input));
    });

    it(`F-110 step 2: ${label} as printed parses with no errors`, () => {
      expect(parseScriptAst(print(input).text)).toMatchObject({
        ok: true,
        errors: [],
      });
    });

    it(`F-110 LA-45: printDeclaration prints each declaration of ${label} as printScript does`, () => {
      const { ast } = print(expected);
      const lines = expected.split("\n");
      for (const item of ast.body) {
        if (
          !("range" in item) ||
          [
            "Block",
            "ExpressionStatement",
            "VariableDeclaration",
            "Assignment",
            "If",
            "TryCatch",
            "Return",
            "Throw",
            "Assert",
            "EmptyStatement",
            "InvalidDeclaration",
          ].includes(item.kind)
        )
          continue;
        const decl = item as Declaration;
        const first = decl.leadingComments?.[0]?.range.line ?? decl.range.line;
        const slice = `${lines.slice(first - 1, decl.range.endLine).join("\n")}\n`;
        const result = printDeclaration(decl, {
          layout: createLayout(expected),
        });
        expect(result.text).toBe(slice);
        expect(result.missingComments).toEqual([]);
      }
    });
  }

  it("F-110 ADR-0005: every known difference of the manifest is used and defined", () => {
    const used = new Set(
      manifest.files.flatMap((f) =>
        f.knownDifference ? [f.knownDifference] : [],
      ),
    );
    expect([...used].sort()).toEqual(
      Object.keys(manifest.knownDifferences).sort(),
    );
  });
});
