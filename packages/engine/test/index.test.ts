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

describe("projection exports", () => {
  it("F-106 AR-10 AR-11: the entry exports the projector, the node-key functions and the type formatters", () => {
    expect(entry.createProjector).toBeTypeOf("function");
    expect(entry.formatNodeKey).toBeTypeOf("function");
    expect(entry.parseNodeKey).toBeTypeOf("function");
    expect(entry.formatFlowType).toBeTypeOf("function");
    expect(entry.formatType).toBeTypeOf("function");
  });
});
