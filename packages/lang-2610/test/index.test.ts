import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configCatalogue, scriptCatalogue } from "../src/catalogue";
import * as entry from "../src/index";
import { palette } from "../src/palette";

describe("@nf-builder/lang-2610", () => {
  it("ADR-0003: the entry module loads", () => {
    expect(entry).toBeTypeOf("object");
  });
});

describe("LanguagePack", () => {
  it("LA-01 ADR-0006: the pack entry exports a LanguagePack for 26.10", () => {
    expect(entry.pack.version).toBe("26.10");
  });
});

describe("LanguagePack palette and catalogue", () => {
  it("F-204 ADR-0028 UX-12: the pack exposes its palette overlay and loads its catalogue on demand", async () => {
    expect(entry.pack.palette).toBe(palette);
    const catalogue = await entry.pack.loadCatalogue();
    expect(catalogue.script).toEqual(scriptCatalogue);
    expect(catalogue.config).toEqual(configCatalogue);
    expect(await entry.pack.loadCatalogue()).toEqual(catalogue);
  });
});

describe("F-104 the pack loads its parser lazily", () => {
  it("F-104 ADR-0027 ADR-0028: the pack loads its parser on demand", async () => {
    const parser = await entry.pack.loadParser();
    expect(parser.parseScript).toBeTypeOf("function");
    expect(parser.parseConfig).toBeTypeOf("function");
    expect(await entry.pack.loadParser()).toEqual(parser);
  });

  it("F-104 ADR-0027 QA-01: the pack entry imports no parser module statically", () => {
    const source = readFileSync(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    const statics = [
      ...source.matchAll(
        /^\s*(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/gms,
      ),
    ].map((m) => m[1] as string);
    for (const spec of statics)
      expect(spec, spec).not.toMatch(
        /\.\/(ast|parser|source|generated)|antlr4ng/,
      );
    expect(source).toMatch(/import\(["']\.\/source\/index\.ts["']\)/);
  });
});
