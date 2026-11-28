import { describe, expect, it } from "vitest";
import { activeViewport, registerViewport } from "../src/canvas/viewport";

const viewport = (tab: string) => ({
  tab,
  centre: () => ({ x: 1, y: 2 }),
});

describe("F-301 viewport bridge", () => {
  it("F-301 UX-15: activeViewport returns the registered viewport for its tab only, and nothing after unregistering", () => {
    const v = viewport("main.nf#");
    const unregister = registerViewport(v);
    expect(activeViewport("main.nf#")).toBe(v);
    expect(activeViewport("other.nf#")).toBeNull();
    unregister();
    expect(activeViewport("main.nf#")).toBeNull();
  });

  it("F-301: a viewport registered later for the same tab replaces the earlier, and the earlier one's unregister leaves it", () => {
    const first = viewport("t");
    const second = viewport("t");
    const undoFirst = registerViewport(first);
    const undoSecond = registerViewport(second);
    undoFirst();
    expect(activeViewport("t")).toBe(second);
    undoSecond();
    expect(activeViewport("t")).toBeNull();
  });
});
