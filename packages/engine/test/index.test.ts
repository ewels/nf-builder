import { describe, expect, it } from "vitest";
import * as entry from "../src/index";

describe("@nf-builder/engine", () => {
  it("ADR-0003: the entry module loads", () => {
    expect(entry).toBeTypeOf("object");
  });
});

describe("palette exports", () => {
  it("ADR-0028: the entry exports loadPalette and searchPalette", () => {
    expect(entry.loadPalette).toBeTypeOf("function");
    expect(entry.searchPalette).toBeTypeOf("function");
    expect(entry.paletteItemCount).toBeTypeOf("function");
  });
});
