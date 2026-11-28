import { describe, expect, it } from "vitest";
import { processUses } from "../../src/config/uses";
import { open, openTree, oracle } from "./helpers";

describe("F-601 process uses", () => {
  it("F-601 FI-06: processUses on f601-selectors lists GREETING:GREET, SHOUT, TWICE_A and TWICE_B with declared names, aliases and labels", async () => {
    const { model } = await openTree(oracle("f601-selectors"));
    const uses = processUses(model);
    expect(uses.entry).toBe("main.nf");
    const by = (fq: string) => uses.uses.find((u) => u.fq === fq);
    expect(uses.uses.map((u) => u.fq).sort()).toEqual([
      "GREETING:GREET",
      "SHOUT",
      "TWICE_A",
      "TWICE_B",
    ]);
    expect(by("GREETING:GREET")).toEqual({
      fq: "GREETING:GREET",
      simple: "GREET",
      base: "GREET",
      labels: [],
      path: "main.nf",
    });
    expect(by("SHOUT")?.labels).toEqual(["big_mem"]);
    expect(by("TWICE_A")).toEqual({
      fq: "TWICE_A",
      simple: "TWICE_A",
      base: "TWICE",
      labels: [],
      path: "modules/local/twice/main.nf",
    });
    expect(by("TWICE_B")?.base).toBe("TWICE");
  });

  it("F-601 FI-06: legacy pipes and calls inside closures or ifs are found; recursion stops; no entry workflow counts declarations", async () => {
    const legacy = await open({
      "main.nf":
        "process A {\n  script:\n  'a'\n}\nprocess B {\n  label 'x'\n  label 'y'\n  script:\n  'b'\n}\nprocess C {\n  script:\n  'c'\n}\nprocess D {\n  script:\n  'd'\n}\nworkflow {\n  channel.of(1) | A\n  channel.of(2) & B | view\n  if (params.x) {\n    C(channel.of(3))\n  }\n  channel.of(4).map { v -> D(v) }\n}\n",
    });
    expect(
      processUses(legacy.model)
        .uses.map((u) => u.fq)
        .sort(),
    ).toEqual(["A", "B", "C", "D"]);
    expect(
      processUses(legacy.model).uses.find((u) => u.fq === "B")?.labels,
    ).toEqual(["x", "y"]);

    const cycle = await open({
      "main.nf":
        "process A {\n  script:\n  'a'\n}\nworkflow W {\n  A(channel.of(1))\n  W()\n}\nworkflow {\n  W()\n}\n",
    });
    expect(
      processUses(cycle.model)
        .uses.map((u) => u.fq)
        .sort(),
    ).toEqual(["W:A"]);

    const none = await open({
      "main.nf":
        "process A {\n  script:\n  'a'\n}\nworkflow W {\n  A(channel.of(1))\n}\n",
      "other.nf": "process Z {\n  script:\n  'z'\n}\n",
    });
    const all = processUses(none.model);
    expect(all.entry).toBeNull();
    expect(all.uses.map((u) => [u.fq, u.simple, u.base]).sort()).toEqual([
      ["A", "A", "A"],
      ["Z", "Z", "Z"],
    ]);
  });
});
