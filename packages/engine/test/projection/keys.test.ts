import type { NodeKey, NodeKeyLocal } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  formatNodeKey,
  KeyAllocator,
  parseNodeKey,
} from "../../src/projection/keys";

const key = (
  path: string,
  workflow: string | null,
  local: NodeKeyLocal,
): NodeKey => ({ path, workflow, local });

describe("F-106 AR-11 ADR-0008 node keys", () => {
  it("F-106 AR-11 ADR-0008: node keys are <file>#<workflow>/<assigned variable>, or <callee>@<n> when nothing is assigned", () => {
    const f = (workflow: string | null, local: NodeKeyLocal) =>
      formatNodeKey(key("main.nf", workflow, local));
    expect(f(null, { kind: "assigned", variable: "x", occurrence: 1 })).toBe(
      "main.nf#/x",
    );
    expect(
      f("PREPARE", { kind: "assigned", variable: "x", occurrence: 1 }),
    ).toBe("main.nf#PREPARE/x");
    expect(f(null, { kind: "assigned", variable: "x", occurrence: 2 })).toBe(
      "main.nf#/x~2",
    );
    expect(
      f(null, { kind: "unassigned", callee: "ALIGN", occurrence: 1 }),
    ).toBe("main.nf#/ALIGN@1");
    expect(
      f(null, { kind: "unassigned", callee: "channel.of", occurrence: 1 }),
    ).toBe("main.nf#/channel.of@1");
    expect(
      f(null, { kind: "unassigned", callee: ".view", occurrence: 1 }),
    ).toBe("main.nf#/.view@1");
    expect(f(null, { kind: "code", occurrence: 1 })).toBe("main.nf#/:code@1");
    expect(f("W", { kind: "take", name: "reads" })).toBe(
      "main.nf#W/:take:reads",
    );
    expect(f("W", { kind: "emit", name: "out" })).toBe("main.nf#W/:emit:out");
    expect(f(null, { kind: "params" })).toBe("main.nf#/:params");
    expect(f(null, { kind: "output" })).toBe("main.nf#/:output");
  });

  it("F-106 AR-11: parseNodeKey inverts formatNodeKey and distinct keys never format alike", () => {
    let seed = 12345;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    const names = ["workflow", "output", "params", "take", "emit", "x", "a_b1"];
    const paths = ["main.nf", "modules/a#b/main.nf", "#", "a/#b#/c.nf", "x#y"];
    const pick = <T>(list: readonly T[]): T => list[next(list.length)] as T;
    const locals = (): NodeKeyLocal => {
      switch (next(7)) {
        case 0:
          return {
            kind: "assigned",
            variable: pick(names),
            occurrence: 1 + next(4),
          };
        case 1:
          return {
            kind: "unassigned",
            callee: pick([...names, "channel.of", ".view", "PROC"]),
            occurrence: 1 + next(4),
          };
        case 2:
          return { kind: "code", occurrence: 1 + next(4) };
        case 3:
          return { kind: "take", name: pick(names) };
        case 4:
          return { kind: "emit", name: pick(names) };
        case 5:
          return { kind: "params" };
        default:
          return { kind: "output" };
      }
    };
    const seen = new Map<string, string>();
    for (let i = 0; i < 500; i++) {
      const k = key(pick(paths), next(2) === 0 ? null : pick(names), locals());
      const id = formatNodeKey(k);
      expect(parseNodeKey(id), id).toEqual(k);
      const json = JSON.stringify(k);
      const earlier = seen.get(id);
      if (earlier !== undefined) expect(json).toBe(earlier);
      seen.set(id, json);
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  it("F-106 AR-11: parseNodeKey rejects text that is not a key", () => {
    for (const bad of [
      "",
      "main.nf",
      "main.nf#",
      "main.nf#x",
      "main.nf#/",
      "main.nf#/x~1",
      "main.nf#/x~02",
      "main.nf#/X@0",
      "main.nf#/X@",
      "main.nf#/:nope",
      "main.nf#/:code@0",
      "main.nf#/:take:",
    ])
      expect(parseNodeKey(bad), bad).toBeNull();
  });

  it("F-106 AR-11: the allocator numbers unassigned nodes per callee and assignments per variable, in source order", () => {
    const keys = new KeyAllocator("main.nf", null);
    expect(keys.params()).toBe("main.nf#/:params");
    expect(keys.take("reads")).toBe("main.nf#/:take:reads");
    expect(keys.assigned("ch")).toBe("main.nf#/ch");
    expect(keys.unassigned("channel.of")).toBe("main.nf#/channel.of@1");
    expect(keys.assigned("ch")).toBe("main.nf#/ch~2");
    expect(keys.unassigned("PROC")).toBe("main.nf#/PROC@1");
    expect(keys.unassigned("channel.of")).toBe("main.nf#/channel.of@2");
    expect(keys.assigned("other")).toBe("main.nf#/other");
    expect(keys.assigned("ch")).toBe("main.nf#/ch~3");
    expect(keys.code()).toBe("main.nf#/:code@1");
    expect(keys.code()).toBe("main.nf#/:code@2");
    expect(keys.emit("out")).toBe("main.nf#/:emit:out");
    expect(keys.output()).toBe("main.nf#/:output");
    const named = new KeyAllocator("a#b.nf", "W");
    expect(named.assigned("x")).toBe("a#b.nf#W/x");
  });
});
