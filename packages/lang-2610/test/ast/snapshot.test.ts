import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import { printAst } from "./print-ast.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(dir, "fixtures.json"), "utf8"),
) as { fixtures: { file: string; sections: string[] }[] };

describe("F-102 step 1: AST snapshots of the syntax-reference constructs", () => {
  for (const { file, sections } of manifest.fixtures) {
    it(`F-102 step 1 AR-02 LA-10: ${file} (${sections.join(", ")}) matches its AST snapshot`, async () => {
      const text = readFileSync(join(dir, "fixtures", file), "utf8");
      const result = parseScriptAst(text);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      // The fixture is lint-clean.
      expect(result.errors).toEqual([]);
      await expect(printAst(result.ast, text)).toMatchFileSnapshot(
        `snapshots/${file}.txt`,
      );
    });
  }
});
