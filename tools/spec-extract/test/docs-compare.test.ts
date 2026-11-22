import { describe, expect, it } from "vitest";
import {
  callablesFromHeadings,
  compare,
  directivesFromTable,
  featureFlagsFromHeadings,
  operatorsFromHeadings,
} from "../src/docs-compare.ts";

describe("docs-compare", () => {
  it("F-006 step 3: directives, operators, factories and feature flags are counted from docs reference pages", () => {
    const directives = [
      "| Directive | Description |",
      "| --------- | ----------- |",
      "| [`afterScript`][after-script] | A Bash snippet. |",
      "| [`accelerator`][accelerator] | GPUs. |",
      "",
      "Some prose with | [`notARow`] in it.",
    ].join("\n");
    expect(directivesFromTable(directives)).toEqual([
      "accelerator",
      "afterScript",
    ]);

    const operators =
      "# Operators\n\n## branch\n\ntext\n\n## collect\n\n### sub\n";
    expect(operatorsFromHeadings(operators)).toEqual(["branch", "collect"]);

    const callables = [
      "##### `combine( other: Channel<R> ) -> Channel<Tuple>` {#combine}",
      "##### `combine( [opts] ) -> Channel<Record>`",
      "##### `map( transform: (E) -> R ) -> Channel<R>` {#map}",
      "###### `checkIfExists`",
    ].join("\n");
    expect(callablesFromHeadings(callables)).toEqual(["combine", "map"]);

    const flags =
      "##### `nextflow.enable.strict`\n\n##### `nextflow.enable.dsl`\n\n##### `other`\n";
    expect(featureFlagsFromHeadings(flags)).toEqual([
      "nextflow.enable.dsl",
      "nextflow.enable.strict",
    ]);
  });

  it("F-006 step 3: compare lists names only in the docs and only in the catalogue", () => {
    expect(compare(["a", "b", "c"], ["b", "c", "d", "e"])).toEqual({
      docsOnly: ["a"],
      catalogueOnly: ["d", "e"],
      both: 2,
    });
    expect(compare([], [])).toEqual({
      docsOnly: [],
      catalogueOnly: [],
      both: 0,
    });
  });
});
