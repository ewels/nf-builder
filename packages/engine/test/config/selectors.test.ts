import type { ConfigAst, ConfigSelector } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { matchSelector } from "../../src/config/selectors";
import type { ProcessUses } from "../../src/config/types";
import { processUses } from "../../src/config/uses";
import { openTree, oracle } from "./helpers";

describe("F-601 selectors", () => {
  it("F-601 FI-06: every f601-selectors selector matches what Nextflow 26.10.7 applied in the oracle run", async () => {
    const { model } = await openTree(oracle("f601-selectors"));
    const uses = processUses(model);
    const ast = model.file("nextflow.config")?.source.ast as ConfigAst;
    const process = ast.statements[0];
    if (process?.kind !== "ConfigBlock") throw new Error("no process block");
    const selectors = process.statements.filter(
      (s): s is ConfigSelector => s.kind === "ConfigSelector",
    );
    const counts = selectors.map(
      (s) =>
        matchSelector(
          {
            kind: s.selector.name as "withName" | "withLabel",
            pattern: s.target.name,
          },
          uses,
        ).count,
    );
    expect(counts).toEqual([1, 1, 1, 2, 1, 2, 2, 1, 3, 0, 0]);
    const names = matchSelector({ kind: "withName", pattern: "TWICE" }, uses);
    expect([...names.processes].sort()).toEqual(["TWICE_A", "TWICE_B"]);
    expect(names.note).toBeNull();
  });

  it("F-601 FI-06: patterns are trimmed, ! negates, labels match any label, and an uncompilable pattern gives null with a note", () => {
    const use = (fq: string, labels: string[] = []) => ({
      fq,
      simple: fq.split(":").pop() as string,
      base: fq.split(":").pop() as string,
      labels,
      path: "main.nf",
    });
    const uses: ProcessUses = {
      entry: "main.nf",
      uses: [use("A", ["x", "y"]), use("W:B"), use("C", ["y"])],
    };
    const count = (kind: "withName" | "withLabel", pattern: string) =>
      matchSelector({ kind, pattern }, uses).count;
    expect(count("withName", "  A  ")).toBe(1);
    expect(count("withName", " ! A ")).toBe(2);
    expect(count("withName", "W:B")).toBe(1);
    expect(count("withName", "B")).toBe(1);
    expect(count("withName", "A|C")).toBe(2);
    expect(count("withName", "A.")).toBe(0);
    expect(count("withLabel", "y")).toBe(2);
    expect(count("withLabel", "x")).toBe(1);
    expect(count("withLabel", "!y")).toBe(1);
    const bad = matchSelector({ kind: "withName", pattern: "(" }, uses);
    expect(bad.count).toBeNull();
    expect(bad.processes).toEqual([]);
    expect(bad.note).toBe("Can't evaluate this pattern");
    const many: ProcessUses = {
      entry: null,
      uses: Array.from({ length: 60 }, (_, i) => use(`P${i}`)),
    };
    const big = matchSelector({ kind: "withName", pattern: "P.*" }, many);
    expect(big.count).toBe(60);
    expect(big.processes).toHaveLength(50);
  });
});
