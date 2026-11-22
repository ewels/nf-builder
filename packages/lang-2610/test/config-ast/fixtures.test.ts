import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type ConfigAst, walk } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";
import { printAst } from "../ast/print-ast.ts";
import { checkConfigRanges } from "./check-config-ranges.ts";

const root = join(
  import.meta.dirname,
  "../../../../tools/oracle/cases/config-constructs",
);
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.endsWith(".config")
        ? [join(dir, e.name)]
        : [],
  );
const fixtures = files(root)
  .map((f) => relative(root, f))
  .sort();
const build = (text: string): ConfigAst => {
  const result = parseConfigAst(text);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.ast;
};

describe("F-103 step 1: AST snapshots of the config constructs", () => {
  it("F-103 step 1: the construct fixtures are the oracle case's files", () => {
    expect(fixtures).toEqual([
      "assignments.config",
      "blocks.config",
      "comments.config",
      "conf/test.config",
      "includes.config",
      "other.config",
      "path/extra.config",
      "plugins.config",
      "process-ext.config",
      "profiles.config",
      "selectors.config",
      "values.config",
    ]);
  });

  for (const file of fixtures) {
    it(`F-103 step 1 FI-01 FI-05: ${file} matches its AST snapshot and has no errors`, async () => {
      const text = readFileSync(join(root, file), "utf8");
      const result = parseConfigAst(text);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      expect(result.errors).toEqual([]);
      await expect(printAst(result.ast, text)).toMatchFileSnapshot(
        `snapshots/${file}.txt`,
      );
    });
  }
});

describe("F-103 step 2: every node's range slices back to its exact source text", () => {
  for (const file of fixtures) {
    it(`F-103 step 2 AR-01: every node and comment range in ${file} slices back to its exact source`, () => {
      const text = readFileSync(join(root, file), "utf8");
      expect(checkConfigRanges(build(text), text, { reparse: true })).toEqual(
        [],
      );
    });
  }

  it("F-103 step 2 AR-01: CRLF files give the same layout, and a lone CR is a column character", () => {
    const layout = (ast: ConfigAst) => {
      const out: unknown[] = [];
      walk(ast, (n) => {
        out.push([
          n.kind,
          n.range.line,
          n.range.column,
          n.range.endLine,
          n.range.endColumn,
        ]);
        return undefined;
      });
      return out;
    };
    for (const file of ["blocks.config", "comments.config", "values.config"]) {
      const lf = readFileSync(join(root, file), "utf8");
      const crlf = lf.replaceAll("\n", "\r\n");
      expect(layout(build(crlf)), file).toEqual(layout(build(lf)));
      expect(checkConfigRanges(build(crlf), crlf), file).toEqual([]);
    }
    const lone = "a = 1\rb = 2";
    const ast = build(lone);
    expect(ast.statements[1]?.range).toMatchObject({
      line: 1,
      column: 7,
      start: 6,
    });
  });

  it("F-103 step 2 AR-01: columns count code points and offsets UTF-16 units", () => {
    const text = "a = '𝐀𝐀'\nb = 1\n";
    const ast = build(text);
    expect(ast.statements[0]?.range).toMatchObject({
      start: 0,
      end: 10,
      column: 1,
      endColumn: 9,
    });
    expect(ast.statements[1]?.range).toMatchObject({
      start: 11,
      line: 2,
      column: 1,
    });
    expect(checkConfigRanges(ast, text, { reparse: true })).toEqual([]);
  });

  it("F-103 step 2: the checker rejects a range one character too wide or too narrow, and text outside every statement", () => {
    const text = "docker.enabled = true\nprocess { cpus = 2 }\n";
    const mutate = (change: (ast: ConfigAst) => void) => {
      const ast = structuredClone(build(text));
      change(ast);
      return checkConfigRanges(ast, text);
    };
    expect(checkConfigRanges(build(text), text, { reparse: true })).toEqual([]);
    const grow = (r: { end: number; endColumn: number }, by: number) => {
      r.end += by;
      r.endColumn += by;
    };
    expect(mutate((a) => grow(a.statements[0]?.range as never, 1))).not.toEqual(
      [],
    );
    expect(
      mutate((a) => grow(a.statements[0]?.range as never, -1)),
    ).not.toEqual([]);
    // a statement dropped from the tree leaves text no node accounts for
    expect(mutate((a) => ((a.statements as unknown[]).length = 1))).not.toEqual(
      [],
    );
  });
});
