import type { ConnectionTarget } from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import {
  portRefOfHandle,
  targetStatusMap,
} from "../src/canvas/connect-targets";

describe("F-302 connect targets", () => {
  it("F-302 UX-25: handle ids map to port refs; targets map by node and port", () => {
    expect(portRefOfHandle("n", "out:out")).toEqual({ node: "n", port: "out" });
    expect(portRefOfHandle("n", "in:reads:x")).toEqual({
      node: "n",
      port: "reads:x",
    });
    expect(portRefOfHandle("n", "other")).toBeNull();
    expect(portRefOfHandle("n", null)).toBeNull();
    const targets: ConnectionTarget[] = [
      { node: "a", port: "x", status: "ok", message: null },
      { node: "a", port: "y", status: "refused", message: "no" },
      { node: "b", port: "x", status: "mismatch", message: "types" },
    ];
    const map = targetStatusMap(targets);
    expect(map.get("a")?.get("x")).toBe("ok");
    expect(map.get("a")?.get("y")).toBe("refused");
    expect(map.get("b")?.get("x")).toBe("mismatch");
    expect(map.get("c")).toBeUndefined();
  });
});
