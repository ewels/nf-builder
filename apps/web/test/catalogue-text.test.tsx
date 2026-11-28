import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatalogueText, withoutReadMore } from "../src/config/catalogue-text";

const html = (markdown: string) =>
  renderToStaticMarkup(<CatalogueText markdown={markdown} />);

describe("F-601 catalogue text", () => {
  it("F-601 FI-04: renders paragraphs, inline code, emphasis, https links in a new tab and fenced code", () => {
    const out = html(
      "The `memory` *directive* is **big**, see [docs](https://docs.seqera.io/x).\n\nSecond paragraph.\n\n```groovy\nmemory = 8.GB\n```",
    );
    expect(out.match(/<p>/g)).toHaveLength(2);
    expect(out).toContain("<code>memory</code>");
    expect(out).toContain("<em>directive</em>");
    expect(out).toContain("<strong>big</strong>");
    expect(out).toContain(
      '<a href="https://docs.seqera.io/x" target="_blank" rel="noopener noreferrer">docs</a>',
    );
    expect(out).toContain("<pre><code>memory = 8.GB\n</code></pre>");
  });

  it("F-601: catalogue text never renders raw HTML, and only https links become links", () => {
    const out = html(
      "<img src=x onerror=alert(1)> [bad](javascript:alert(1)) [http](http://example.org) <script>x</script>",
    );
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<a ");
    expect(out).toContain("&lt;img");
    expect(out).toContain("[bad](javascript:alert(1))");
  });

  it("F-601 FI-04: withoutReadMore drops a trailing Read more paragraph and nothing else", () => {
    expect(
      withoutReadMore("About it.\n\n[Read more](https://docs.seqera.io/a)"),
    ).toBe("About it.");
    expect(withoutReadMore("About it.")).toBe("About it.");
    expect(
      withoutReadMore("[Read more](https://x.y) is in the middle.\n\nEnd."),
    ).toBe("[Read more](https://x.y) is in the middle.\n\nEnd.");
  });
});
