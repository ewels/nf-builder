import { pack } from "@nf-builder/lang-2610";
import type {
  Catalogue,
  PaletteDefinition,
  PaletteView,
  PaletteViewCategory,
} from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  firstParagraph,
  plainText,
  resolvePaletteView,
} from "../src/palette-view";

let catalogue: Catalogue;
let view: PaletteView;
beforeAll(async () => {
  catalogue = await pack.loadCatalogue();
  view = resolvePaletteView(pack.version, pack.palette, catalogue);
});

const keyOf = (item: { kind: string; name: string; id?: string }) =>
  item.kind === "construct" ? (item.id as string) : `${item.kind}:${item.name}`;
const allItems = (v: PaletteView) =>
  v.categories.flatMap((c: PaletteViewCategory) => [
    ...c.items,
    ...c.groups.flatMap((g) => g.items),
  ]);
const item = (key: string) => {
  const found = allItems(view).find((i) => i.key === key);
  if (!found) throw new Error(`no ${key}`);
  return found;
};

describe("resolvePaletteView", () => {
  it("F-204 UX-12: resolvePaletteView keeps the pack's categories, labels, operator groups and item order", () => {
    expect(view.version).toBe(pack.version);
    expect(view.categories.map((c) => [c.id, c.label])).toEqual(
      pack.palette.categories.map((c) => [c.id, c.label]),
    );
    for (const [i, c] of pack.palette.categories.entries()) {
      const v = view.categories[i] as PaletteViewCategory;
      expect(v.items.map((x) => x.key)).toEqual((c.items ?? []).map(keyOf));
      expect(v.groups.map((g) => [g.id, g.label])).toEqual(
        (c.groups ?? []).map((g) => [g.id, g.label]),
      );
      for (const [j, g] of (c.groups ?? []).entries())
        expect((v.groups[j]?.items ?? []).map((x) => x.key)).toEqual(
          g.items.map(keyOf),
        );
    }
    const count = pack.palette.categories.reduce(
      (n, c) =>
        n +
        (c.items?.length ?? 0) +
        (c.groups ?? []).reduce((m, g) => m + g.items.length, 0),
      0,
    );
    expect(allItems(view)).toHaveLength(count);
  });

  it("F-204 UX-12: catalogue items take label and description from the catalogue as plain text; constructs keep their own", () => {
    const groupBy = item("operator:groupBy");
    expect(groupBy.label).toBe("groupBy");
    expect(
      groupBy.summary.startsWith("The groupBy operator collects values"),
    ).toBe(true);
    for (const i of allItems(view))
      for (const text of [i.summary, i.description])
        for (const bad of ["`", "](", "Read more"])
          expect(text, i.key).not.toContain(bad);
    const construct = pack.palette.categories
      .flatMap((c) => c.items ?? [])
      .find((i) => i.kind === "construct" && i.id === "process");
    if (construct?.kind !== "construct") throw new Error("no process");
    expect(item("process").label).toBe(construct.label);
    expect(item("process").description).toBe(construct.description);
  });

  it("F-204 UX-12: an operator takes the description of its modern Channel overload", () => {
    const entry = (
      name: string,
      description: string,
      deprecated: boolean,
      receiver?: "Channel" | "Value",
    ) => ({
      name,
      description,
      deprecated,
      signatures: [],
      ...(receiver ? { receiver } : {}),
    });
    const script = {
      ...catalogue.script,
      operators: [
        entry("op", "Value overload.", false, "Value"),
        entry("op", "Old channel overload.", true, "Channel"),
        entry("op", "Modern channel overload.", false, "Channel"),
      ],
      factories: [
        entry("fac", "Old factory.", true),
        entry("fac", "Modern factory.", false),
      ],
    } as Catalogue["script"];
    const palette: PaletteDefinition = {
      categories: [
        {
          id: "factories",
          label: "F",
          icon: "factory",
          items: [{ kind: "factory", name: "fac" }],
        },
        {
          id: "operators",
          label: "O",
          icon: "operator",
          items: [{ kind: "operator", name: "op" }],
        },
      ],
    };
    const v = resolvePaletteView("99.01", palette, { ...catalogue, script });
    expect(v.categories[0]?.items[0]?.description).toBe("Modern factory.");
    expect(v.categories[1]?.items[0]?.description).toBe(
      "Modern channel overload.",
    );
  });

  it("F-204 UX-12: items inherit their category icon unless they set one", () => {
    expect(item("agent").icon).toBe("agent");
    expect(item("process").icon).toBe("process");
    expect(item("config:plugins").icon).toBe("plugin");
  });

  it("F-204 UX-13: only items marked preview are preview; Agent is", () => {
    expect(item("agent").preview).toBe(true);
    for (const i of allItems(view))
      expect(i.preview, i.key).toBe(i.key === "agent");
  });

  it("F-204 step 3 UX-13 ADR-0007: no resolved operator or factory is legacy-only in the pack's catalogue", () => {
    for (const i of allItems(view)) {
      if (i.kind === "operator") {
        const entries = catalogue.script.operators.filter(
          (o) => o.name === i.name,
        );
        expect(
          entries.some((o) => !o.deprecated),
          i.key,
        ).toBe(true);
      }
      if (i.kind === "factory") {
        const entries = catalogue.script.factories.filter(
          (o) => o.name === i.name,
        );
        expect(
          entries.some((o) => !o.deprecated),
          i.key,
        ).toBe(true);
      }
    }
    expect(allItems(view).map((i) => i.key)).not.toContain(
      "operator:groupTuple",
    );
  });

  it("F-204 ADR-0028: resolvePaletteView throws on a name the catalogue lacks", () => {
    const palette: PaletteDefinition = {
      categories: [
        {
          id: "operators",
          label: "O",
          icon: "operator",
          items: [{ kind: "operator", name: "nope" }],
        },
      ],
    };
    expect(() => resolvePaletteView("99.01", palette, catalogue)).toThrow(
      'palette item operator:nope: no operator "nope" in the 99.01 catalogue',
    );
  });
});

describe("plainText", () => {
  it("F-204 UX-11: plainText drops Read more links, keeps link text, unquotes code spans; firstParagraph takes the first paragraph", () => {
    const md =
      "The `map`   operator\napplies [a function](https://x.y/z).\n\nSecond paragraph.\n\n[Read more](https://docs.example/a)";
    const text = plainText(md);
    expect(text).toBe(
      "The map operator applies a function.\n\nSecond paragraph.",
    );
    expect(firstParagraph(text)).toBe("The map operator applies a function.");
    expect(firstParagraph("")).toBe("");
  });
});
