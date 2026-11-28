import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fileTabFor } from "../src/canvas/canvas-store";
import { CodePane } from "../src/code/code-pane";
import { TabStripView } from "../src/shell/tab-strip";

const noop = () => undefined;

const html = (tab = fileTabFor("modules/local/x/main.nf"), readOnly = false) =>
  renderToStaticMarkup(
    <TabStripView
      tabs={[tab]}
      activeTab={tab.id}
      controls={null}
      onSelect={noop}
      onMode={noop}
      onClose={noop}
      readOnly={readOnly}
    />,
  );

describe("F-210 file tabs", () => {
  it('F-210 UX-20 QA-10: a file tab has its path as title and no view-mode toggle, and the tablist is "Open workflows and files"', () => {
    const markup = html();
    expect(markup).toContain('aria-label="Open workflows and files"');
    expect(markup).toContain('title="modules/local/x/main.nf"');
    expect(markup).toContain('aria-keyshortcuts="Delete"');
    expect(markup).not.toContain("view-mode");
  });

  it("F-210 UX-20 QA-10: the tablist holds only tabs; the close control is pointer-only, hidden from assistive tech and out of the tab order", () => {
    const markup = html();
    const list = /<div role="tablist"[^>]*>(.*?)<\/div>/.exec(markup)?.[1];
    expect(list).toBeDefined();
    const buttons = (list as string).match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(1);
    for (const button of buttons) {
      expect(button).toContain('role="tab"');
      expect(button).toContain('aria-keyshortcuts="Delete"');
    }
    const close = /<span[^>]*workflow-tab-close[^>]*>/.exec(
      list as string,
    )?.[0];
    expect(close).toContain('aria-hidden="true"');
    expect(close).not.toContain("tabindex");
    expect(markup).not.toContain('aria-label="Close');
  });

  it("F-210 F-703 UX-04: a file tab keeps its close button while read-only, since closing a tab doesn't write the project (ADR 0056 doesn't hide it)", () => {
    expect(html(undefined, true)).toContain("workflow-tab-close");
  });

  it("F-210 UX-20: a workflow tab has no close button", () => {
    const markup = html({
      kind: "workflow",
      id: "main.nf#",
      path: "main.nf",
      workflow: null,
      label: "main.nf",
      mode: "graph",
      readOnly: null,
    });
    expect(markup).not.toContain("workflow-tab-close");
    expect(markup).not.toContain('aria-keyshortcuts="Delete"');
    expect(markup).toContain("view-mode");
  });

  it("F-210 IO-02: a read-only code pane says why", () => {
    const markup = renderToStaticMarkup(
      <CodePane path=".nf-builder/layout.json" readOnly="managed" />,
    );
    expect(markup).toContain(
      "Read-only: nf-builder keeps .nf-builder/ up to date itself.",
    );
    expect(renderToStaticMarkup(<CodePane path="main.nf" />)).not.toContain(
      "Read-only",
    );
  });
});
