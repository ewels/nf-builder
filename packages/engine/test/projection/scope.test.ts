import { describe, expect, it } from "vitest";
import { type Value, WorkflowScope } from "../../src/projection/scope";
import { UNKNOWN, wrapFlow } from "../../src/projection/types";

const path = wrapFlow("plain", { name: "Path", args: [], nullable: false });
const port = (id: string) => ({ id, label: id, type: path });
const single: Value = { node: "n#/a", ports: [port("out")] };
const multi: Value = { node: "n#/m", ports: [port("bam"), port("log")] };

describe("F-106 AR-10 scope", () => {
  it("F-106 AR-10: bind replaces and lookup returns the bound values, none when unbound", () => {
    const scope = new WorkflowScope();
    expect(scope.lookup("x")).toEqual([]);
    scope.bind("x", [single]);
    expect(scope.lookup("x")).toEqual([single]);
    scope.bind("x", [multi]);
    expect(scope.lookup("x")).toEqual([multi]);
  });

  it("F-106 AR-10: resolveRead reads the one output of a single-output value, a named output, or every output", () => {
    const scope = new WorkflowScope();
    scope.bind("a", [single]);
    scope.bind("m", [multi]);
    expect(scope.resolveRead({ name: "a", properties: [] })).toEqual({
      variable: "a",
      consumed: 0,
      sources: [{ port: { node: "n#/a", port: "out" }, type: path }],
    });
    expect(
      scope.resolveRead({ name: "a", properties: ["size"] }),
    ).toMatchObject({ variable: "a", consumed: 0 });
    expect(scope.resolveRead({ name: "m", properties: ["log", "x"] })).toEqual({
      variable: "m.log",
      consumed: 1,
      sources: [{ port: { node: "n#/m", port: "log" }, type: path }],
    });
    const all = scope.resolveRead({ name: "m", properties: [] });
    expect(all?.sources.map((s) => s.port.port)).toEqual(["bam", "log"]);
    expect(
      scope.resolveRead({ name: "m", properties: ["other"] })?.consumed,
    ).toBe(0);
    expect(scope.resolveRead({ name: "nope", properties: [] })).toBeNull();
  });

  it("F-106 AR-10: a name can bind several values, and a value with no outputs resolves to nothing", () => {
    const scope = new WorkflowScope();
    const other: Value = {
      node: "n#/b",
      ports: [{ id: "out", label: "out", type: UNKNOWN }],
    };
    scope.bind("x", [single, other]);
    const read = scope.resolveRead({ name: "x", properties: [] });
    expect(read?.sources.map((s) => s.port.node)).toEqual(["n#/a", "n#/b"]);
    scope.bind("v", [{ node: "n#/v", ports: [] }]);
    expect(scope.resolveRead({ name: "v", properties: [] })).toBeNull();
  });
});
