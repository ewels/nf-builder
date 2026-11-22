import { describe, expect, it } from "vitest";
import { scriptCatalogue } from "../src/catalogue";
import { pack } from "../src/index";
import { legacyOperators } from "../src/legacy-operators";

describe("F-107 LA-02 legacy operators", () => {
  it("F-107 LA-02: legacy operators come from the pack and none duplicates a catalogue operator", () => {
    expect(pack.legacyOperators).toBe(legacyOperators);
    const names = legacyOperators.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(17);
    const catalogued = new Set(scriptCatalogue.operators.map((o) => o.name));
    for (const name of names) expect(catalogued.has(name), name).toBe(false);
  });

  it("F-107 LA-02 AR-14: result kinds follow the operator reference's Returns lines", () => {
    const value = legacyOperators
      .filter((o) => o.result === "value")
      .map((o) => o.name);
    expect(value).toEqual([
      "countFasta",
      "countFastq",
      "countJson",
      "countLines",
      "first",
      "last",
    ]);
    const assign = legacyOperators
      .filter((o) => o.result === "assign")
      .map((o) => o.name);
    expect(assign).toEqual(["set", "tap"]);
  });
});
