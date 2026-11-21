import { describe, expect, it } from "vitest";
import * as entry from "../src/index";

describe("@nf-builder/lang-2610", () => {
  it("ADR-0003: the entry module loads", () => {
    expect(entry).toBeTypeOf("object");
  });
});
