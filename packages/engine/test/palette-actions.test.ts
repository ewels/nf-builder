import { describe, expect, it } from "vitest";
import { installedPackVersions } from "../src/packs";
import { loadPalette } from "../src/palette";
import { paletteAction } from "../src/palette-actions";

describe("F-301 palette actions", () => {
  it("F-301 UX-15: process and workflow have an action; every other 26.10 palette item has none", async () => {
    const view = await loadPalette(installedPackVersions()[0] as string);
    const items = view.categories.flatMap((c) => [
      ...c.items,
      ...c.groups.flatMap((g) => g.items),
    ]);
    expect(items.length).toBeGreaterThan(20);
    const acting = items
      .filter((i) => paletteAction(i) !== null)
      .map((i) => i.key);
    expect(acting.sort()).toEqual(["process", "workflow"]);
    expect(paletteAction({ key: "process" })).toEqual({ kind: "process" });
    expect(paletteAction({ key: "workflow" })).toEqual({ kind: "workflow" });
  });
});
