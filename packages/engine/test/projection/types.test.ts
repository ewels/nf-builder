import { NO_RANGE, type TypeRef, type Wildcard } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { installedPacks } from "../../src/packs";
import {
  asEmitType,
  flowFromDeclared,
  formatFlowType,
  formatType,
  parseTypeText,
  typeFromRef,
  UNKNOWN,
  wrapFlow,
} from "../../src/projection/types";

const ref = (
  name: string,
  typeArguments: (TypeRef | Wildcard)[] = [],
  nullable = false,
): TypeRef => ({
  kind: "TypeRef",
  range: NO_RANGE,
  name,
  typeArguments,
  nullable,
});
const wildcard: Wildcard = { kind: "Wildcard", range: NO_RANGE };

describe("F-106 LA-28 types", () => {
  it("F-106 LA-28: declared types map to channel, value or plain flow types", () => {
    const f = (r: TypeRef | null) => {
      const flow = flowFromDeclared(r);
      return flow === null ? null : formatFlowType(flow);
    };
    expect(f(ref("Channel", [ref("Sample")]))).toBe("Channel<Sample>");
    expect(f(ref("Value", [ref("Path")]))).toBe("Value<Path>");
    expect(f(ref("Path"))).toBe("Path");
    expect(f(ref("String", [], true))).toBe("String?");
    expect(f(ref("Map", [ref("String"), wildcard]))).toBe("Map<String, ?>");
    expect(f(null)).toBeNull();
    expect(flowFromDeclared(ref("Channel", [ref("Sample")]))).toEqual({
      dataflow: "channel",
      element: { name: "Sample", args: [], nullable: false },
    });
    expect(flowFromDeclared(ref("Path"))?.dataflow).toBe("plain");
    expect(flowFromDeclared(ref("Channel"))).toEqual({
      dataflow: "channel",
      element: null,
    });
    expect(typeFromRef(ref("List", [wildcard], true))).toEqual({
      name: "List",
      args: [{ name: "?", args: [], nullable: false }],
      nullable: true,
    });
  });

  it("F-106 LA-28: formatting and wrapping flow types", () => {
    const path = parseTypeText("Path");
    expect(formatFlowType(UNKNOWN)).toBe("?");
    expect(formatFlowType(wrapFlow("channel", null))).toBe("Channel<?>");
    expect(formatFlowType(wrapFlow("value", path))).toBe("Value<Path>");
    expect(formatFlowType(wrapFlow("plain", path))).toBe("Path");
    expect(formatFlowType(wrapFlow("value", parseTypeText("Bag<?>")))).toBe(
      "Value<Bag<?>>",
    );
  });

  it("F-106 LA-28: a plain emit type is wrapped as Value, as nf-lang's workflowEmitType does", () => {
    const path = parseTypeText("Path");
    expect(asEmitType(wrapFlow("plain", path))).toEqual(
      wrapFlow("value", path),
    );
    expect(asEmitType(wrapFlow("channel", path))).toEqual(
      wrapFlow("channel", path),
    );
    expect(asEmitType(wrapFlow("value", path))).toEqual(
      wrapFlow("value", path),
    );
    expect(asEmitType(UNKNOWN)).toEqual(UNKNOWN);
  });

  it("F-106 LA-28: every catalogue type text parses and formats back", async () => {
    const pack = installedPacks[0];
    if (pack === undefined) throw new Error("no pack installed");
    const { script } = await pack.loadCatalogue();
    const texts = new Set<string>();
    const entries = [
      ...script.operators,
      ...script.factories,
      ...script.functions,
      ...script.processSections.typedOutputs,
    ];
    for (const entry of entries)
      for (const signature of entry.signatures) {
        texts.add(signature.returns);
        for (const parameter of signature.parameters) texts.add(parameter.type);
      }
    expect(texts.size).toBeGreaterThan(40);
    for (const text of texts) {
      const parsed = parseTypeText(text);
      // `E...` (varargs) parses as `E`; the rest round-trips exactly
      expect(formatType(parsed), text).toBe(text.replace(/\.\.\.$/, ""));
    }
    expect(parseTypeText("Value<Bag<E>>")).toEqual({
      name: "Value",
      args: [
        {
          name: "Bag",
          args: [{ name: "E", args: [], nullable: false }],
          nullable: false,
        },
      ],
      nullable: false,
    });
    expect(parseTypeText("Set<Map.Entry<K, V>>").args[0]?.name).toBe(
      "Map.Entry",
    );
    expect(parseTypeText("Object...").name).toBe("Object");
  });
});
