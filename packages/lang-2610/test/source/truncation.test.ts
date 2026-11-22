import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { assertCut, cutSet } from "./cuts.ts";
import { configFixtures, scriptFixtures } from "./files.ts";

const files = [
  ...scriptFixtures().map((path) => ({ path, config: false })),
  ...configFixtures().map((path) => ({ path, config: true })),
];

describe("F-104 IO-14 ADR-0004: truncating a file", () => {
  for (const { path, config } of files) {
    const file = path.replace(/^.*(ast\/fixtures|config-constructs)\//, "");
    it(`F-104 IO-14 ADR-0004: cutting ${file} anywhere keeps every earlier complete declaration modelled and loses no text`, () => {
      const set = cutSet(readFileSync(path, "utf8"), config, 8);
      for (const cut of set.cuts) assertCut(set, cut);
    });
  }
});
