import type {
  IncludeRules,
  LanguagePack,
  SourceParser,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { installedPackVersions } from "../../src/packs";
import { loadParser } from "../../src/source/parser";

const stub: SourceParser = {
  printer: {} as SourceParser["printer"],
  parseScript: () => ({ status: "verbatim", ast: null, problems: [] }),
  parseConfig: () => ({ status: "verbatim", ast: null, problems: [] }),
};
const fake = (load: () => Promise<SourceParser>): LanguagePack => ({
  version: "99.01",
  palette: { categories: [] },
  includes: {} as IncludeRules,
  scaffold: { process: () => "", workflow: () => "" },
  legacyOperators: [],
  loadCatalogue: () => Promise.reject(new Error("not used here")),
  loadParser: load,
  loadLints: () => Promise.reject(new Error("not used here")),
  loadTemplates: () => Promise.reject(new Error("not used here")),
});

describe("F-104 ADR-0027 ADR-0028: loadParser", () => {
  it("F-104 ADR-0027 ADR-0028: loadParser loads the pack's parser once and memoises it; an unknown version rejects and a failed load is retried", async () => {
    let loads = 0;
    const pack = fake(async () => {
      loads += 1;
      return stub;
    });
    const a = await loadParser("99.01", [pack]);
    const b = await loadParser("99.01", [pack]);
    expect(loads).toBe(1);
    expect(b).toBe(a);

    await expect(loadParser("0.00", [])).rejects.toThrow(
      "No language pack for 0.00",
    );

    let calls = 0;
    const flaky = fake(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network");
      return stub;
    });
    await expect(loadParser("99.01", [flaky])).rejects.toThrow("network");
    expect(await loadParser("99.01", [flaky])).toBe(stub);
    expect(calls).toBe(2);

    const real = await loadParser(installedPackVersions()[0] as string);
    expect(real.parseScript("workflow {\n}\n").status).toBe("modelled");
  });
});
