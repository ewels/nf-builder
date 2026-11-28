import type { Diagnostic } from "@nf-builder/engine";
import { problemKey, problemSections } from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProblemsPanelView } from "../src/problems/problems-panel";

const at = (line: number, column: number, start: number) => ({
  start,
  end: start + 7,
  line,
  column,
  endLine: line,
  endColumn: column + 7,
});
const warning: Diagnostic = {
  path: "main.nf",
  range: at(4, 15, 95),
  severity: "warning",
  message: "The use of `Channel` is deprecated -- use `channel` instead",
  code: "deprecated-channel",
  fix: {
    title: "Replace `Channel` with `channel`",
    path: "main.nf",
    edits: [{ start: 95, end: 102, text: "channel" }],
  },
};
const error: Diagnostic = {
  path: "lib.nf",
  range: at(2, 1, 20),
  severity: "error",
  message: "Unexpected token",
  code: "syntax",
};
const hint: Diagnostic = {
  path: "main.nf",
  range: at(3, 1, 70),
  severity: "suggestion",
  message: "Legacy workflow",
  code: "legacy-workflow",
};

const render = (
  list: Diagnostic[],
  over: Partial<Parameters<typeof ProblemsPanelView>[0]> = {},
) =>
  renderToStaticMarkup(
    <ProblemsPanelView
      sections={problemSections(list)}
      view="problems"
      applying={null}
      notice={null}
      onView={() => undefined}
      onClose={() => undefined}
      onGo={() => undefined}
      onFix={() => undefined}
      {...over}
    />,
  );

describe("problems panel", () => {
  it("F-309 UX-03 QA-12: each row shows a severity word and glyph, the message, its line and column, and the code", () => {
    const html = render([warning, error, hint]);
    expect(html).toContain('id="problems-panel"');
    expect(html).toContain('aria-label="Problems and suggestions"');
    expect(html).toContain("✕");
    expect(html).toContain("▲");
    expect(html).toContain("Error");
    expect(html).toContain("Warning");
    expect(html).toContain(warning.message);
    expect(html).toMatch(/title="Line 4, column 15"[^>]*>4:15</);
    expect(html).toContain("deprecated-channel");
    // grouped by file in path order, each with a header; the suggestion is on the other tab
    expect(html.indexOf("lib.nf")).toBeLessThan(html.indexOf("main.nf"));
    expect(html).not.toContain("Legacy workflow");
    expect(render([warning, hint], { view: "suggestions" })).toContain(
      "Legacy workflow",
    );
  });

  it("F-309 ADR-0042: a fixable row has a button named by the fix title, with its backticked words in code, and aria-disabled (still focusable) while that fix is applying", () => {
    const idle = render([warning, error]);
    expect(idle).toMatch(
      /<button[^>]*class="problem-fix"[^>]*>Replace <code>Channel<\/code> with <code>channel<\/code><\/button>/,
    );
    expect(idle.slice(idle.indexOf('class="problem-fix"'))).not.toContain("`");
    expect(idle).not.toMatch(
      /class="problem-fix"[^>]*(disabled|aria-disabled)/,
    );
    const busy = render([warning, error], { applying: problemKey(warning) });
    expect(busy).toMatch(/class="problem-fix"[^>]*aria-disabled="true"/);
    expect(busy).not.toMatch(/class="problem-fix"[^>]*\sdisabled/);
    // the syntax error has no fix button
    expect(idle.match(/class="problem-fix"/g)).toHaveLength(1);
  });

  it("F-703 UX-04 F-309: read-only, a fixable row has no fix button but still has its go button", () => {
    const narrow = render([warning, error], { readOnly: true });
    expect(narrow).not.toContain("problem-fix");
    expect(narrow.match(/class="problem-go"/g)).toHaveLength(2);
  });

  it('F-309 UX-03: the tabs show their counts, and an empty tab reads "No problems" or "No suggestions"', () => {
    const html = render([warning, error, hint]);
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Problem kinds"/);
    expect(html).toMatch(
      /role="tab"[^>]*aria-selected="true"[^>]*>Problems <span[^>]*>2</,
    );
    expect(html).toMatch(
      /role="tab"[^>]*aria-selected="false"[^>]*>Suggestions <span[^>]*>1</,
    );
    expect(render([])).toContain("No problems");
    expect(render([], { view: "suggestions" })).toContain("No suggestions");
    expect(render([], { notice: "Applied: x" })).toMatch(
      /role="status"[^>]*>Applied: x</,
    );
    expect(render([])).toMatch(/role="status"/);
    // the notice shows backticked words in code, too
    expect(
      render([], { notice: "Applied: Replace `Channel` with `channel`" }),
    ).toContain(
      "Applied: Replace <code>Channel</code> with <code>channel</code>",
    );
  });

  it("F-309 QA-11: an empty list takes the tab stop itself, as it has no focusable content", () => {
    const empty = render([]);
    expect(empty.slice(empty.indexOf('role="tabpanel"'))).toMatch(
      /^role="tabpanel"[^>]*tabindex="0"/,
    );
  });

  it("F-309 QA-11: the list has exactly one tab stop", () => {
    const html = render([warning, error]);
    const panel = html.slice(html.indexOf('role="tabpanel"'));
    expect(panel.match(/tabindex="0"/g)).toHaveLength(1);
    expect(panel.match(/tabindex="-1"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("F-405 LA-35: the Suggestions tab marks registry groups with a registry tag after a Registry modules heading", () => {
    const own: Diagnostic = { ...hint, path: "z.nf" };
    const registered: Diagnostic = {
      ...hint,
      path: "modules/nf-core/fastqc/main.nf",
    };
    const registry = [
      { path: "modules/nf-core/fastqc", module: "nf-core/fastqc" },
    ];
    const html = render([registered, own, hint], {
      view: "suggestions",
      sections: problemSections([registered, own, hint], registry),
    });
    expect(html).toContain("Registry modules");
    expect(html).toContain("1 suggestion)");
    expect(html.indexOf("z.nf")).toBeLessThan(html.indexOf("Registry modules"));
    expect(html.indexOf("Registry modules")).toBeLessThan(
      html.indexOf("modules/nf-core/fastqc/main.nf"),
    );
    expect(html).toMatch(
      /class="problems-tag"[^>]*title="Registry module nf-core\/fastqc"[^>]*>registry</,
    );
    expect(render([hint], { view: "suggestions" })).not.toContain(
      "Registry modules",
    );
  });
});
