import { describe, expect, it } from "vitest";
import * as entry from "../src/index";

describe("@nf-builder/sources", () => {
  it("ADR-0003: the entry module loads", () => {
    expect(entry).toBeTypeOf("object");
  });
});
