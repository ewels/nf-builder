import { describe, expect, it } from "vitest";
import { paletteAdd, paletteAddMessage } from "../src/palette/use-palette-add";

describe("F-301 palette add message", () => {
  it("F-301 QA-11: the same message said twice in a row changes the live region's text, so it is announced again", async () => {
    const item = { key: "operator:map", label: "map" };
    await paletteAdd(item, null);
    const first = paletteAddMessage();
    await paletteAdd(item, null);
    const second = paletteAddMessage();
    expect(first).toBe("map can't be added from the palette yet.");
    expect(second).not.toBe(first);
    expect(second?.trim()).toBe(first);
    await paletteAdd(item, null);
    expect(paletteAddMessage()).not.toBe(second);
  });
});
