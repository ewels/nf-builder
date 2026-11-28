import type { Diagnostic } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { problemSections, registryModuleOf } from "../../src/problems";

const diag = (
  path: string,
  start: number,
  severity: Diagnostic["severity"],
): Diagnostic => ({
  path,
  range: {
    start,
    end: start + 1,
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 2,
  },
  severity,
  message: `m ${start}`,
  code: "c",
});

const registry = [{ path: "modules/nf-core/fastqc", module: "nf-core/fastqc" }];
const list = [
  diag("modules/nf-core/fastqc/main.nf", 1, "suggestion"),
  diag("modules/nf-core/fastqc/main.nf", 2, "warning"),
  diag("modules/local/a/main.nf", 1, "suggestion"),
  diag("modules/local/a/main.nf", 2, "error"),
  diag("main.nf", 1, "suggestion"),
  diag("z.nf", 1, "suggestion"),
];

describe("F-405 registry groups", () => {
  it("F-405 LA-35: registry module files sort after the project's own files in both tabs and carry their module reference", () => {
    const s = problemSections(list, registry);
    for (const tab of [s.suggestions, s.problems]) {
      const modules = tab.map((g) => g.module);
      const firstRegistry = modules.indexOf("nf-core/fastqc");
      expect(firstRegistry).toBe(modules.length - 1);
      expect(modules.slice(0, -1).every((m) => m === null)).toBe(true);
    }
    expect(s.suggestions.map((g) => g.path)).toEqual([
      "main.nf",
      "modules/local/a/main.nf",
      "z.nf",
      "modules/nf-core/fastqc/main.nf",
    ]);
  });

  it("F-405 UX-03: counts are unchanged by grouping", () => {
    expect(problemSections(list, registry).counts).toEqual(
      problemSections(list).counts,
    );
  });

  it("F-309: with no registry list the order is path order as before", () => {
    const s = problemSections(list);
    expect(s.suggestions.map((g) => g.path)).toEqual([
      "main.nf",
      "modules/local/a/main.nf",
      "modules/nf-core/fastqc/main.nf",
      "z.nf",
    ]);
    expect(s.suggestions.every((g) => g.module === null)).toBe(true);
  });

  it("F-405: registryModuleOf finds the folder holding a file, and a nested folder wins", () => {
    const nested = [
      ...registry,
      { path: "modules/nf-core/fastqc/modules/nf-core/x", module: "nf-core/x" },
    ];
    expect(registryModuleOf("modules/nf-core/fastqc/main.nf", nested)).toBe(
      "nf-core/fastqc",
    );
    expect(
      registryModuleOf(
        "modules/nf-core/fastqc/modules/nf-core/x/main.nf",
        nested,
      ),
    ).toBe("nf-core/x");
    expect(registryModuleOf("main.nf", nested)).toBeNull();
  });
});
