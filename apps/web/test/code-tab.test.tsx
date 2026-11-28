import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeTab } from "../src/popup/code-tab";

const problem = {
  source: "internal" as const,
  message: "Unexpected token.",
  line: 3,
  column: 1,
  endLine: 3,
  endColumn: 2,
};
const base = {
  path: "main.nf",
  name: "GREET",
  text: "process GREET {\n}",
  span: { start: 0, end: 16 },
  check: "valid" as const,
  problems: [],
  message: null,
  showWhole: false,
  onToggleWhole: () => undefined,
  onChange: () => undefined,
  onFormat: () => undefined,
};

describe("F-304 code tab", () => {
  it("F-304 UX-43: Format is enabled while the code parses and disabled while it doesn't", () => {
    const ok = renderToStaticMarkup(<CodeTab {...base} />);
    expect(ok).toMatch(/<button(?![^>]*disabled)[^>]*>Format<\/button>/);
    const invalid = renderToStaticMarkup(
      <CodeTab
        {...base}
        check="invalid"
        problems={[problem]}
        message={problem.message}
      />,
    );
    expect(invalid).toMatch(/<button[^>]*disabled[^>]*>Format<\/button>/);
  });

  it("F-304 UX-43: Show whole file is a toggle button with aria-pressed", () => {
    const off = renderToStaticMarkup(<CodeTab {...base} />);
    expect(off).toMatch(
      /<button[^>]*aria-pressed="false"[^>]*>Show whole file/,
    );
    const on = renderToStaticMarkup(<CodeTab {...base} showWhole />);
    expect(on).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Show whole file/);
  });

  it("F-304 step 2 UX-44: the status line shows the first problem", () => {
    const html = renderToStaticMarkup(
      <CodeTab
        {...base}
        check="invalid"
        problems={[problem]}
        message={problem.message}
      />,
    );
    expect(html).toMatch(/role="status"[^>]*>Unexpected token\./);
  });
});
