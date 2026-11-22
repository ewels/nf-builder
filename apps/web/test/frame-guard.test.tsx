import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FramedNotice, isFramed } from "../src/frame-guard";

describe("frame guard", () => {
  it("F-011 step 4 QA-30: isFramed is true only when window.top is not window.self", () => {
    const self = {};
    expect(isFramed({ top: self, self })).toBe(false);
    expect(isFramed({ top: {}, self })).toBe(true);
    expect(isFramed({ top: null, self })).toBe(true);
  });

  it("F-011 step 4 QA-30: FramedNotice says the app can't run inside another page and links to the same address in a new tab", () => {
    const html = renderToStaticMarkup(
      <FramedNotice href="https://example.org/nf-builder/?a=1&b=2" />,
    );
    expect(html).toContain("nf-builder can&#x27;t run inside another page.");
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/example\.org\/nf-builder\/\?a=1&amp;b=2"/,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">Open in a new tab</a>");
    expect(html).not.toContain("style=");
  });
});
