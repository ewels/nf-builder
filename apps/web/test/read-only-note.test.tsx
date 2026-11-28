import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadOnlyNoteView } from "../src/read-only/read-only-note";

describe("F-703 read-only note", () => {
  it("F-703 UX-04 QA-10: read-only, the note is a polite status region that says editing needs a larger screen", () => {
    const html = renderToStaticMarkup(<ReadOnlyNoteView readOnly />);
    expect(html).toMatch(/^<div[^>]*class="read-only-note"[^>]*role="status"/);
    expect(html).toMatch(
      /<p[^>]*tabindex="-1"[^>]*>Read-only view: editing needs a larger screen or a wider window\.<\/p>/,
    );
  });

  it("F-703: editable, the status container is empty", () => {
    expect(renderToStaticMarkup(<ReadOnlyNoteView readOnly={false} />)).toBe(
      '<div class="read-only-note" role="status"></div>',
    );
  });
});
