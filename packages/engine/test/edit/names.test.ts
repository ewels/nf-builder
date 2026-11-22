import { describe, expect, it } from "vitest";
import {
  freshName,
  isIdentifier,
  moduleDirectory,
  relativeSource,
} from "../../src/edit/names";

describe("F-111 LA-12: names and paths", () => {
  it("F-111: isIdentifier accepts Nextflow identifiers only", () => {
    for (const ok of ["A", "_x", "fastqc_2", "HELLO"])
      expect(isIdentifier(ok), ok).toBe(true);
    for (const bad of ["", "1a", "a-b", "a b", "é", "a.b"])
      expect(isIdentifier(bad), bad).toBe(false);
  });

  it("F-111: freshName appends _2, _3 until the name is free", () => {
    expect(freshName("x", new Set())).toBe("x");
    expect(freshName("x", new Set(["x"]))).toBe("x_2");
    expect(freshName("x", new Set(["x", "x_2"]))).toBe("x_3");
  });

  it("F-111 LA-12: the module directory is the lower-case name under modules/local", () => {
    expect(moduleDirectory("FASTQC_2")).toBe("modules/local/fastqc_2");
  });

  it("F-111 LA-12 AR-03: relativeSource is relative to the calling script's directory", () => {
    const target = "modules/local/hello/main.nf";
    expect(relativeSource("main.nf", target)).toBe(`./${target}`);
    expect(relativeSource("subworkflows/local/x/main.nf", target)).toBe(
      `../../../${target}`,
    );
    expect(relativeSource("modules/local/a.nf", target)).toBe(
      "./hello/main.nf",
    );
    expect(relativeSource("modules/b/c.nf", target)).toBe(
      "../local/hello/main.nf",
    );
  });
});
