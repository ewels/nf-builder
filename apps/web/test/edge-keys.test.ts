import { describe, expect, it } from "vitest";
import { edgeKeyAction } from "../src/canvas/edge-keys";

describe("F-302 edge keys", () => {
  it("F-302 UX-70: Delete and Backspace disconnect, Enter selects, Escape clears; nothing read-only", () => {
    expect(edgeKeyAction("Delete", false)).toBe("disconnect");
    expect(edgeKeyAction("Backspace", false)).toBe("disconnect");
    expect(edgeKeyAction("Enter", false)).toBe("select");
    expect(edgeKeyAction("Escape", false)).toBe("clear");
    expect(edgeKeyAction("a", false)).toBeNull();
    for (const key of ["Delete", "Backspace", "Enter", "Escape"])
      expect(edgeKeyAction(key, true)).toBeNull();
  });
});
