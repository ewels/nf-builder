import { describe, expect, it } from "vitest";
import { popupTarget } from "../../src/form/popup-target";
import { base, call, port } from "../details/helpers";

describe("F-303 popup target", () => {
  it("F-303 UX-40 UX-42: only a call of a modelled typed process opens Configure; workflow, legacy, unresolved and other kinds don't, each with a reason", () => {
    expect(
      popupTarget(call("a", { typed: true, name: "GREET", path: "g.nf" })),
    ).toEqual({ kind: "typedProcess", path: "g.nf", name: "GREET" });
    expect(popupTarget(call("a", { kind: "workflow", typed: true }))).toEqual({
      kind: "workflow",
    });
    expect(popupTarget(call("a", { typed: false }))).toEqual({
      kind: "unavailable",
      reason: "Editing legacy processes arrives with Migrate to typed.",
    });
    expect(
      popupTarget(call("a", { status: "unresolved", path: null, name: "X" })),
    ).toEqual({
      kind: "unavailable",
      reason: "X isn't found in the project.",
    });
    expect(popupTarget(call("a", { status: "unparsed", typed: true }))).toEqual(
      {
        kind: "unavailable",
        reason:
          "P has code that doesn't parse. Fix it in the Code tab before editing it here.",
      },
    );
    expect(popupTarget(call("a", { kind: "agent", typed: true }))).toEqual({
      kind: "unavailable",
      reason: "Configure isn't available for agent nodes yet.",
    });
    expect(
      popupTarget({
        ...base("b", "x", [port("in")], [port("out")]),
        kind: "factory",
        namespace: "channel",
        factory: "of",
      }),
    ).toEqual({
      kind: "unavailable",
      reason: "Configure isn't available for factory nodes yet.",
    });
  });
});
