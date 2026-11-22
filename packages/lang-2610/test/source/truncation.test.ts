import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ConfigAst, ScriptAst } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseConfigAst, parseScriptAst } from "../../src/ast/index.ts";
import {
  parseConfigSource,
  parseScriptSource,
} from "../../src/source/parse-source.ts";
import { prescan } from "../../src/source/prescan.ts";
import { checkTiling } from "./tiling.ts";

const root = (p: string) =>
  fileURLToPath(new URL(`../../../../${p}`, import.meta.url));
const filesIn = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesIn(`${dir}/${e.name}`, ext)
      : ext.test(e.name)
        ? [`${dir}/${e.name}`]
        : [],
  );

const topItems = (ast: ScriptAst | ConfigAst) =>
  ast.kind === "Script" ? ast.body : ast.statements;

const files = [
  ...filesIn(
    fileURLToPath(new URL("../ast/fixtures", import.meta.url)),
    /\.nf$/,
  ).map((path) => ({ path, config: false })),
  ...filesIn(root("tools/oracle/cases/config-constructs"), /\.config$/).map(
    (path) => ({
      path,
      config: true,
    }),
  ),
];

describe("F-104 IO-14 ADR-0004: truncating a file", () => {
  for (const { path, config } of files) {
    const file = path.replace(/^.*(ast\/fixtures|config-constructs)\//, "");
    it(`F-104 IO-14 ADR-0004: cutting ${file} anywhere keeps every earlier complete declaration modelled and loses no text`, () => {
      const text = readFileSync(path, "utf8");
      const grammar = config ? "config" : "script";
      const whole = config ? parseConfigAst(text) : parseScriptAst(text);
      if (!whole.ok) return;
      const wholeItems = topItems(whole.ast);
      const chunks = prescan(text, grammar).chunks;
      let seed = 7;
      const cuts = new Set<number>();
      for (const c of chunks)
        for (const d of [-1, 0, 1])
          cuts.add(Math.max(0, Math.min(text.length, c.start + d)));
      for (let i = 0; i < 8; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        cuts.add(seed % (text.length + 1));
      }
      for (const cut of cuts) {
        const prefix = text.slice(0, cut);
        const r = config
          ? parseConfigSource(prefix)
          : parseScriptSource(prefix);
        if (r.ast) expect(checkTiling(prefix, r.ast), `cut ${cut}`).toEqual([]);
        // items of the chunks that end before the one holding the cut are unchanged
        const holder = chunks.findIndex((c) => cut >= c.start && cut < c.end);
        const firstHeld =
          holder < 0 ? text.length : (chunks[holder]?.start ?? 0);
        if (whole.errors.length > 0) continue;
        const keep = wholeItems.filter((i) => i.range.end <= firstHeld);
        const got = r.ast ? topItems(r.ast) : [];
        expect(got.slice(0, keep.length), `cut ${cut}`).toEqual(keep);
      }
    });
  }
});
