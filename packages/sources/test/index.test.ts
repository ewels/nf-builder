import { describe, expect, it } from "vitest";
import * as entry from "../src/index";

describe("@nf-builder/sources", () => {
  it("ADR-0003: the entry module loads", () => {
    expect(entry).toBeTypeOf("object");
  });

  it("F-502 IO-30: the entry exports createRegistryClient", () => {
    expect(entry.createRegistryClient).toBeTypeOf("function");
  });
});
