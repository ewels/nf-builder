import { pack } from "@nf-builder/lang-2610";
import type {
  PaletteView,
  PaletteViewCategory,
  PaletteViewItem,
} from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  paletteItemCount,
  queryTerms,
  searchPalette,
} from "../src/palette-search";
import { resolvePaletteView } from "../src/palette-view";

let real: PaletteView;
beforeAll(async () => {
  real = resolvePaletteView(
    pack.version,
    pack.palette,
    await pack.loadCatalogue(),
  );
});

const keys = (v: PaletteView) =>
  v.categories.flatMap((c) => [
    ...c.items.map((i) => i.key),
    ...c.groups.flatMap((g) => g.items.map((i) => i.key)),
  ]);

const mk = (
  name: string,
  extra: Partial<PaletteViewItem> = {},
): PaletteViewItem => ({
  key: `operator:${name}`,
  kind: "operator",
  name,
  label: name,
  summary: "",
  description: "",
  keywords: [],
  icon: "operator",
  preview: false,
  ...extra,
});
const cat = (
  id: PaletteViewCategory["id"],
  label: string,
  items: PaletteViewItem[],
  groups: PaletteViewCategory["groups"] = [],
): PaletteViewCategory => ({ id, label, icon: "operator", items, groups });
const view = (...categories: PaletteViewCategory[]): PaletteView => ({
  version: "99.01",
  categories,
});

describe("searchPalette", () => {
  it('F-204 step 2 UX-11: searching "group" finds groupBy under Operators > Reduce, and no legacy-only operator', () => {
    const result = searchPalette(real, "group");
    expect(keys(result)).toContain("operator:groupBy");
    expect(keys(result)).not.toContain("operator:groupTuple");
    const operators = result.categories.find((c) => c.id === "operators");
    expect(operators?.groups.map((g) => g.id)).toEqual(["reduce"]);
  });

  it("F-204 UX-11: matching is case-insensitive and ignores surrounding whitespace", () => {
    expect(searchPalette(real, "  GroupBY ")).toEqual(
      searchPalette(real, "groupby"),
    );
    expect(queryTerms("  A  b ")).toEqual(["a", "b"]);
    expect(queryTerms("   ")).toEqual([]);
  });

  it("F-204 UX-11: search matches label, name, description and keywords", () => {
    const v = view(
      cat("operators", "Ops", [
        mk("a", { label: "alpha" }),
        mk("b", { name: "bravo" }),
        mk("c", { description: "charlie text" }),
        mk("d", { keywords: ["delta"] }),
        mk("e"),
      ]),
    );
    expect(keys(searchPalette(v, "alpha"))).toEqual(["operator:a"]);
    expect(keys(searchPalette(v, "bravo"))).toEqual(["operator:b"]);
    expect(keys(searchPalette(v, "charlie"))).toEqual(["operator:c"]);
    expect(keys(searchPalette(v, "delta"))).toEqual(["operator:d"]);
  });

  it("F-204 UX-11: every term must match, each in any field", () => {
    expect(keys(searchPalette(real, "collects key"))).toContain(
      "operator:groupBy",
    );
    expect(paletteItemCount(searchPalette(real, "collects zzz"))).toBe(0);
  });

  it("F-204 UX-11: categories and groups without matches are dropped and item order is kept", () => {
    const v = view(
      cat("processes", "P", [mk("x1")]),
      cat(
        "operators",
        "O",
        [],
        [
          { id: "filter", label: "Filter", items: [mk("y1")] },
          { id: "reduce", label: "Reduce", items: [mk("x3"), mk("x2")] },
        ],
      ),
      cat("factories", "F", [mk("z")]),
    );
    const result = searchPalette(v, "x");
    expect(result.categories.map((c) => c.id)).toEqual([
      "processes",
      "operators",
    ]);
    expect(result.categories[1]?.groups.map((g) => g.id)).toEqual(["reduce"]);
    expect(keys(result)).toEqual(["operator:x1", "operator:x3", "operator:x2"]);
  });

  it("F-204 UX-11: category and group labels are not searched", () => {
    const v = view(
      cat(
        "operators",
        "Findme",
        [mk("a")],
        [{ id: "reduce", label: "Findme", items: [mk("b")] }],
      ),
    );
    expect(searchPalette(v, "findme").categories).toEqual([]);
  });

  it("F-204 UX-11: a blank query returns the view unchanged; a query matching nothing leaves no categories", () => {
    expect(searchPalette(real, "  ")).toBe(real);
    const none = searchPalette(real, "zzzzqqq");
    expect(none.categories).toEqual([]);
    expect(paletteItemCount(none)).toBe(0);
    expect(paletteItemCount(real)).toBe(keys(real).length);
  });
});
