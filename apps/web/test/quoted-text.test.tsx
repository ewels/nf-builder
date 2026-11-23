import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuotedText, quotedParts } from "../src/problems/quoted-text";

describe("quoted text", () => {
  it("F-309 QA-12: backtick-quoted segments are code, without their backticks, and plain text is kept as it is", () => {
    expect(quotedParts("Replace `Channel` with `channel`")).toEqual([
      { text: "Replace ", code: false },
      { text: "Channel", code: true },
      { text: " with ", code: false },
      { text: "channel", code: true },
    ]);
    expect(quotedParts("No quotes")).toEqual([
      { text: "No quotes", code: false },
    ]);
    expect(quotedParts("")).toEqual([]);
    expect(
      renderToStaticMarkup(<QuotedText text="Use `channel.of` here" />),
    ).toBe("Use <code>channel.of</code> here");
  });
});
