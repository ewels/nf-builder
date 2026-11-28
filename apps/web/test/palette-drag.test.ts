import { describe, expect, it } from "vitest";
import {
  hasPaletteDrag,
  PALETTE_MIME,
  readPaletteDrag,
  writePaletteDrag,
} from "../src/palette/palette-drag";

/** The part of DataTransfer these functions use. */
function transfer(types: string[] = []) {
  const data = new Map<string, string>();
  const dt = {
    effectAllowed: "uninitialized",
    types,
    setData(type: string, value: string) {
      data.set(type, value);
      if (!types.includes(type)) types.push(type);
    },
    getData: (type: string) => data.get(type) ?? "",
  };
  return dt as unknown as DataTransfer;
}

describe("F-301 palette drag", () => {
  it("F-301 UX-15: a palette drag carries the item key under its MIME type; file drags aren't palette drags", () => {
    const dt = transfer();
    writePaletteDrag(dt, "process");
    expect(PALETTE_MIME).toBe("application/x-nf-builder-palette");
    expect(dt.effectAllowed).toBe("copy");
    expect(hasPaletteDrag(dt)).toBe(true);
    expect(readPaletteDrag(dt)).toBe("process");
    const files = transfer(["Files"]);
    expect(hasPaletteDrag(files)).toBe(false);
    expect(readPaletteDrag(files)).toBeNull();
  });
});
