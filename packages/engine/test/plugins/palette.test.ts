import { describe, expect, it } from "vitest";
import { queryTerms } from "../../src/palette-search";
import {
  pluginPaletteGroup,
  searchPluginGroups,
} from "../../src/plugins/palette";
import { nfHand, nfSchema } from "./helpers";

describe("plugin palette", () => {
  it("F-505 IO-33: nf-schema 3.1.0 gives six function items with folded signatures", () => {
    const group = pluginPaletteGroup(nfSchema(), "3.1.0", false);
    expect(group).toMatchObject({
      id: "nf-schema",
      version: "3.1.0",
      approximate: false,
    });
    expect(group.items.map((i) => i.name)).toEqual([
      "validate",
      "samplesheetToList",
      "validateParameters",
      "paramsHelp",
      "paramsSummaryMap",
      "paramsSummaryLog",
    ]);
    expect(group.items.every((i) => i.kind === "function")).toBe(true);
    const sheet = group.items.find((i) => i.name === "samplesheetToList");
    expect(sheet?.signatures).toHaveLength(8);
    expect(sheet?.signatures[0]).toBe(
      "samplesheetToList(String, Path) -> List",
    );
    expect(sheet?.key).toBe("plugin:nf-schema:function:samplesheetToList");
    expect(sheet?.summary).toBe("samplesheetToList(String, Path) -> List");
    const params = group.items.find((i) => i.name === "validateParameters");
    expect(params?.signatures).toEqual([
      "validateParameters(Map) -> void",
      "validateParameters() -> void",
    ]);
  });

  it("F-505 IO-33: operators and factories from the hand-written spec get their kinds and keys", () => {
    const group = pluginPaletteGroup(nfHand(), "1.0.0", true);
    expect(group.approximate).toBe(true);
    expect(group.items.map((i) => [i.kind, i.key])).toEqual([
      ["operator", "plugin:nf-hand:operator:tapLog"],
      ["factory", "plugin:nf-hand:factory:fromHand"],
      ["function", "plugin:nf-hand:function:shout"],
    ]);
    const tap = group.items[0];
    expect(tap?.summary).toBe("Logs each item and passes it on.");
    expect(tap?.signatures).toEqual(["tapLog(Channel) -> Channel<Object>"]);
    expect(group.items[1]?.summary).toBe("fromHand() -> Channel");
  });

  it("F-505 UX-11: searchPluginGroups matches name, plugin id and description with queryTerms", () => {
    const groups = [
      pluginPaletteGroup(nfSchema(), "3.1.0", false),
      pluginPaletteGroup(nfHand(), "1.0.0", false),
    ];
    const names = (q: string) =>
      searchPluginGroups(groups, queryTerms(q)).flatMap((g) =>
        g.items.map((i) => i.name),
      );
    expect(names("")).toHaveLength(9);
    expect(names("SAMPLESHEET")).toEqual(["samplesheetToList"]);
    expect(names("nf-hand")).toEqual(["tapLog", "fromHand", "shout"]);
    expect(names("passes on")).toEqual(["tapLog"]);
    expect(names("zzz")).toEqual([]);
    expect(searchPluginGroups(groups, [])).toBe(groups);
  });
});
