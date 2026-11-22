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
