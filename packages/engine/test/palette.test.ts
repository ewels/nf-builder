import type {
  Catalogue,
  IncludeRules,
  LanguagePack,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { installedPackVersions } from "../src/packs";
import { loadPalette } from "../src/palette";

describe("loadPalette", () => {
  it("F-204 ADR-0028: loadPalette resolves the installed pack's palette for its version", async () => {
    const version = installedPackVersions()[0] as string;
    const view = await loadPalette(version);
    expect(view.version).toBe(version);
    expect(view.categories).toHaveLength(7);
  });

  it("F-204 ADR-0028: loadPalette loads each pack's catalogue once and reuses the view", async () => {
    let loads = 0;
    const pack = fake(async (real) => {
      loads += 1;
      return real;
    });
    const a = await loadPalette("99.01", [pack]);
    const b = await loadPalette("99.01", [pack]);
    expect(loads).toBe(1);
    expect(b).toBe(a);
  });

  it("F-204 ADR-0028: loadPalette rejects for a version with no installed pack, and retries after a failed load", async () => {
    await expect(loadPalette("0.00", [])).rejects.toThrow(
      "No language pack for 0.00",
    );
    let calls = 0;
    const pack = fake(async (real) => {
      calls += 1;
      if (calls === 1) throw new Error("network");
      return real;
    });
    await expect(loadPalette("99.01", [pack])).rejects.toThrow("network");
    const view = await loadPalette("99.01", [pack]);
    expect(view.version).toBe("99.01");
    expect(calls).toBe(2);
  });
});

function fake(load: (real: Catalogue) => Promise<Catalogue>): LanguagePack {
  return {
    version: "99.01",
    palette: {
      categories: [
        {
          id: "processes",
          label: "Processes",
          icon: "process",
          items: [
            {
              kind: "construct",
              id: "p",
              name: "p",
              label: "P",
              description: "d",
            },
          ],
        },
      ],
    },
    includes: {} as IncludeRules,
    loadCatalogue: () => load({} as Catalogue),
    loadParser: () => Promise.reject(new Error("not used here")),
  };
}
