import type { ScriptCatalogue } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { installedPacks } from "../../../src/packs";
import {
  type DataflowLibrary,
  dataflowLibrary,
} from "../../../src/projection/library";
import {
  formatFlowType,
  parseTypeText,
  UNKNOWN,
  wrapFlow,
} from "../../../src/projection/types";

let catalogue: ScriptCatalogue;
let library: DataflowLibrary;
let plain: DataflowLibrary;
beforeAll(async () => {
  const pack = installedPacks[0];
  if (pack === undefined) throw new Error("no pack installed");
  catalogue = (await pack.loadCatalogue()).script;
  library = dataflowLibrary(catalogue, pack.legacyOperators);
  plain = dataflowLibrary(catalogue);
});

const channel = (element: string) =>
  wrapFlow("channel", parseTypeText(element));
const kind = (name: string, receiver: ReturnType<typeof channel>): string => {
  const type = library.operatorType(name, receiver, {
    positional: [],
    named: false,
    closures: 0,
  });
  return type === "void" ? "void" : formatFlowType(type);
};

describe("F-107 AR-14 LA-28 legacy operators in the dataflow library", () => {
  it("F-107 AR-14 LA-28: the pack's legacy operators are operators on dataflow receivers, with their documented result kind", () => {
    for (const name of ["first", "last", "concat", "collate", "distinct"]) {
      expect(library.isLegacyOperator(name), name).toBe(true);
      expect(library.isOperator(name, "channel"), name).toBe(true);
      expect(library.isOperator(name, "value"), name).toBe(true);
      expect(library.isOperator(name, null), name).toBe(true);
    }
    expect(library.legacyResult("first")).toBe("value");
    expect(library.legacyResult("last")).toBe("value");
    expect(library.legacyResult("countLines")).toBe("value");
    expect(library.legacyResult("concat")).toBe("channel");
    expect(library.legacyResult("splitFastq")).toBe("channel");
    expect(library.legacyResult("set")).toBe("assign");
    expect(library.legacyResult("tap")).toBe("assign");
    expect(library.legacyResult("map")).toBeNull();
    expect(library.isLegacyOperator("map")).toBe(false);
    // catalogue operators are unchanged, and the library without the pack's data knows none of them
    expect(library.isOperator("filter", "channel")).toBe(true);
    expect(library.isOperator("filter", "value")).toBe(false);
    for (const name of ["first", "set", "tap"]) {
      expect(plain.isLegacyOperator(name), name).toBe(false);
      expect(plain.isOperator(name, null), name).toBe(false);
      expect(plain.legacyResult(name), name).toBeNull();
    }
  });

  it("F-107 AR-14 LA-28: a catalogue operator that fits no overload takes the kind its overloads share; join(b) keeps a channel", () => {
    const join = library.operatorType("join", channel("Record"), {
      positional: [channel("Record")],
      named: false,
      closures: 0,
    });
    expect(join === "void" ? "void" : formatFlowType(join)).toBe("Channel<?>");
    // overloads of different kinds still give no kind
    expect(
      library.operatorType("combine", UNKNOWN, {
        positional: [null, null, null],
        named: false,
        closures: 0,
      }),
    ).toEqual(UNKNOWN);
    expect(kind("filter", channel("Path"))).toBe("Channel<?>");
  });

  it("F-107 AR-31: the library is memoised per catalogue and legacy list", () => {
    const pack = installedPacks[0];
    expect(dataflowLibrary(catalogue, pack?.legacyOperators)).toBe(library);
    expect(dataflowLibrary(catalogue)).toBe(plain);
    expect(plain).not.toBe(library);
  });
});
