import { describe, expect, it } from "vitest";
import { basePath } from "../scripts/base-path.ts";

describe("base path", () => {
  it("F-011 ADR-0040: basePath defaults to / and normalises /nf-builder and /nf-builder/ to /nf-builder/", () => {
    expect(basePath({})).toBe("/");
    expect(basePath({ BASE_PATH: "" })).toBe("/");
    expect(basePath({ BASE_PATH: "/" })).toBe("/");
    expect(basePath({ BASE_PATH: "/nf-builder" })).toBe("/nf-builder/");
    expect(basePath({ BASE_PATH: "/nf-builder/" })).toBe("/nf-builder/");
  });

  it.each([
    "./",
    "./nf-builder/",
    "nf-builder",
    "//host",
    "//host/x/",
    "https://example.com/nf-builder/",
  ])(
    "F-011 ADR-0040: basePath rejects ./, a bare name, //host and absolute URLs (%s)",
    (value) => {
      expect(() => basePath({ BASE_PATH: value })).toThrow(/BASE_PATH/);
    },
  );
});
