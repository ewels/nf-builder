import type { ConfigValue } from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decide, ValueField } from "../src/config/value-field";

const mem = (amount: number): ConfigValue => ({
  kind: "memory",
  amount,
  unit: "GB",
});

describe("F-601 value field", () => {
  it("F-601 FI-02 QA-11: each kind renders a labelled widget with its current value", () => {
    const render = (
      kind: Parameters<typeof ValueField>[0]["kind"],
      value: ConfigValue | null,
    ) =>
      renderToStaticMarkup(
        <ValueField
          kind={kind}
          value={value}
          id="f"
          describedBy="f-note"
          onCommit={async () => undefined}
          onClear={async () => undefined}
        />,
      );
    const text = render("string", { kind: "string", value: "quay.io/x" });
    expect(text).toContain('<input id="f"');
    expect(text).toContain('value="quay.io/x"');
    expect(text).toContain('aria-describedby="f-note"');
    const bool = render("boolean", { kind: "boolean", value: false });
    expect(bool).toContain("<select");
    expect(bool).toContain(">Not set<");
    expect(bool).toMatch(/<option value="false" selected/);
    expect(render("memory", mem(8))).toContain('value="8.GB"');
    const list = render("stringList", {
      kind: "stringList",
      values: ["a", "b"],
    });
    expect(list).toContain("<textarea");
    expect(list).toContain("a\nb");
    const map = render("map", {
      kind: "map",
      entries: [
        { key: "cpus", value: { kind: "integer", value: 4 } },
        { key: "memory", value: mem(8) },
      ],
    });
    for (const key of ["cpus", "memory", "disk", "time"])
      expect(map).toContain(`>${key}<`);
    expect(map).toContain('value="8.GB"');
  });

  it("F-601 FI-02: a disabled field renders disabled", () => {
    const out = renderToStaticMarkup(
      <ValueField
        kind="string"
        value={null}
        id="f"
        disabled
        onCommit={async () => undefined}
        onClear={async () => undefined}
      />,
    );
    expect(out).toContain("disabled");
    expect(out).toContain('placeholder="Not set"');
  });

  it("F-601 FI-02: a valid changed draft commits its parsed value", () => {
    expect(decide("memory", "8.GB", mem(4))).toEqual({
      action: "commit",
      value: mem(8),
    });
    expect(decide("memory", "8 GB", mem(4))).toEqual({
      action: "commit",
      value: mem(8),
    });
    expect(decide("integer", "3", null)).toEqual({
      action: "commit",
      value: { kind: "integer", value: 3 },
    });
  });

  it("F-601 FI-02: an unchanged draft sends nothing, and an empty one clears the option", () => {
    expect(decide("memory", "4.GB", mem(4))).toEqual({ action: "none" });
    expect(decide("string", "", { kind: "string", value: "x" })).toEqual({
      action: "clear",
    });
    expect(decide("string", "", null)).toEqual({ action: "none" });
  });

  it("F-601 FI-02 QA-11: invalid input gives the message and sends nothing", () => {
    expect(decide("memory", "8.5 GB", null)).toEqual({
      action: "invalid",
      message: "Use a whole number and a unit, for example 8.GB",
    });
    expect(decide("integer", "abc", null)).toMatchObject({
      action: "invalid",
    });
  });
});
