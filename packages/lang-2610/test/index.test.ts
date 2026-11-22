import { describe, expect, it } from "vitest";
import * as entry from "../src/index";

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
