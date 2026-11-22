import type { ScriptCatalogue } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { installedPacks } from "../../src/packs";
import {
  type DataflowLibrary,
  dataflowLibrary,
} from "../../src/projection/library";
import {
  formatFlowType,
  parseTypeText,
  UNKNOWN,
  wrapFlow,
} from "../../src/projection/types";

let catalogue: ScriptCatalogue;
let library: DataflowLibrary;
beforeAll(async () => {
  const pack = installedPacks[0];
  if (pack === undefined) throw new Error("no pack installed");
  catalogue = (await pack.loadCatalogue()).script;
  library = dataflowLibrary(catalogue);
});

const t = (text: string) => parseTypeText(text);
const channel = (element: string | null) =>
  wrapFlow("channel", element === null ? null : t(element));
const value = (element: string | null) =>
  wrapFlow("value", element === null ? null : t(element));
const show = (type: ReturnType<DataflowLibrary["operatorType"]>) =>
  type === "void" ? "void" : formatFlowType(type);
const op = (
  name: string,
  receiver: ReturnType<typeof channel>,
  positional: (ReturnType<typeof channel> | null)[] = [],
  extra: { named?: boolean; closures?: number } = {},
) =>
  show(
    library.operatorType(name, receiver, {
      positional,
      named: extra.named ?? false,
      closures: extra.closures ?? 0,
    }),
  );

describe("F-106 LA-24 LA-28 dataflow library", () => {
  it("F-106 AR-12 LA-24: operators are the catalogue's Channel and Value members", () => {
    for (const entry of catalogue.operators)
      expect(
        library.isOperator(entry.name, entry.receiver.toLowerCase() as never),
        `${entry.receiver}.${entry.name}`,
      ).toBe(true);
    expect(library.isOperator("filter", "channel")).toBe(true);
    expect(library.isOperator("filter", "value")).toBe(false);
    expect(library.isOperator("map", "value")).toBe(true);
    for (const name of ["first", "set", "info"]) {
      expect(library.isOperator(name, "channel"), name).toBe(false);
      expect(library.isOperator(name, null), name).toBe(false);
    }
    // an unknown receiver accepts either type
    expect(library.isOperator("filter", null)).toBe(true);
    expect(library.isOperator("flatMap", null)).toBe(true);
  });

  it("F-106 LA-28: operator results follow the catalogue signature with the receiver's element type", () => {
    expect(op("collect", channel("Path"))).toBe("Value<Bag<Path>>");
    expect(op("mix", value("Path"), [channel("Path")])).toBe("Channel<Path>");
    expect(op("mix", channel("String"), [channel("String")])).toBe(
      "Channel<String>",
    );
    expect(op("flatMap", value("Path"), [], { closures: 1 })).toBe(
      "Channel<?>",
    );
    expect(op("map", value("Path"), [], { closures: 1 })).toBe("Value<?>");
    expect(op("map", channel("Path"), [], { closures: 1 })).toBe("Channel<?>");
    expect(op("reduce", channel("Integer"), [], { closures: 1 })).toBe(
      "Value<Integer>",
    );
    expect(op("reduce", channel("Integer"), [null], { closures: 1 })).toBe(
      "Value<?>",
    );
    expect(op("combine", channel("Path"), [], { named: true })).toBe(
      "Channel<Record>",
    );
    expect(op("combine", channel("Path"), [channel("Path")])).toBe(
      "Channel<Tuple>",
    );
    expect(
      op("join", channel("Record"), [channel("Record")], { named: true }),
    ).toBe("Channel<Record>");
    expect(op("view", channel("Path"), [], { closures: 1 })).toBe(
      "Channel<Path>",
    );
    expect(op("view", value("Path"))).toBe("Value<Path>");
    expect(op("filter", channel("Path"), [], { closures: 1 })).toBe(
      "Channel<Path>",
    );
    expect(op("unique", channel("Path"))).toBe("Channel<Path>");
    expect(op("subscribe", channel("Path"), [], { closures: 1 })).toBe("void");
    // an unknown receiver whose overloads agree
    expect(op("filter", UNKNOWN, [], { closures: 1 })).toBe("Channel<?>");
    expect(op("subscribe", UNKNOWN, [], { closures: 1 })).toBe("void");
    // overloads that differ in kind give no kind; a channel argument rules the Value overloads out
    expect(op("combine", UNKNOWN, [null])).toBe("?");
    expect(op("combine", UNKNOWN, [channel("Path")])).toBe("Channel<Tuple>");
  });

  it("F-106 LA-25 LA-28: factory results follow the catalogue, with E and V from literal arguments", () => {
    const f = (
      name: string,
      args: (string | null)[] = [],
      named = false,
    ): string =>
      formatFlowType(
        library.factoryType(
          name,
          args.map((a) => (a === null ? null : t(a))),
          named,
        ),
      );
    expect(library.isFactory("channel", "fromPath")).toBe(true);
    expect(library.isFactory("Channel", "of")).toBe(true);
    expect(library.isFactory("channel", "nope")).toBe(false);
    expect(library.isFactory("params", "of")).toBe(false);
    expect(f("fromPath", ["String"])).toBe("Channel<Path>");
    expect(f("fromPath", ["String"], true)).toBe("Channel<Path>");
    expect(f("of", ["String", "String"])).toBe("Channel<String>");
    expect(f("of", ["Integer", "String"])).toBe("Channel<?>");
    expect(f("of", [null])).toBe("Channel<?>");
    expect(f("value", ["String"])).toBe("Value<String>");
    expect(f("empty")).toBe("Channel<?>");
    expect(f("topic", ["String"])).toBe("Channel<?>");
    expect(f("interval", ["String"])).toBe("Channel<Integer>");
    expect(f("fromList", ["List"])).toBe("Channel<?>");
  });

  it("F-106 LA-28: inline argument types come from catalogue functions", () => {
    expect(
      formatFlowType(wrapFlow("plain", library.functionType("file"))),
    ).toBe("Path");
    expect(library.functionType("record")?.name).toBe("Record");
    expect(library.functionType("tuple")?.name).toBe("Tuple");
    expect(library.functionType("println")).toBeNull();
    expect(library.functionType("nope")).toBeNull();
    expect(library.typedOutputType("stdout")?.name).toBe("String");
    expect(library.typedOutputType("eval")?.name).toBe("String");
    expect(library.typedOutputType("file")).toBeNull();
  });

  it("F-106 LA-24: parameter names label chain ports", () => {
    const names = (
      name: string,
      receiver: ReturnType<typeof channel>,
      positional: (ReturnType<typeof channel> | null)[],
      extra: { named?: boolean; closures?: number } = {},
    ) =>
      library.parameterNames(name, receiver, {
        positional,
        named: extra.named ?? false,
        closures: extra.closures ?? 0,
      });
    expect(names("mix", channel("Path"), [channel("Path")])).toEqual(["other"]);
    expect(names("combine", channel("Path"), [], { named: true })).toEqual([
      "fields",
    ]);
    expect(names("filter", channel("Path"), [], { closures: 1 })).toEqual([
      "condition",
    ]);
    expect(names("filter", channel("Path"), [null, null])).toBeNull();
  });

  it("F-106 AR-31: the library is memoised per catalogue", () => {
    expect(dataflowLibrary(catalogue)).toBe(library);
  });
});
