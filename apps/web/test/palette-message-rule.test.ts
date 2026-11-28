import { describe, expect, it } from "vitest";
import { paletteMessage } from "../src/palette/palette-message-rule";

describe("palette message rule", () => {
  it("F-503 UX-11 F-204: no generic and no registry matches (or registry not ready) give no-match; generic none with registry matches give no-language-match; any generic match gives none", () => {
    expect(paletteMessage(0, 0)).toBe("no-match");
    expect(paletteMessage(0, null)).toBe("no-match");
    expect(paletteMessage(0, 3)).toBe("no-language-match");
    expect(paletteMessage(2, 0)).toBe("none");
    expect(paletteMessage(2, null)).toBe("none");
    expect(paletteMessage(2, 5)).toBe("none");
  });
});
