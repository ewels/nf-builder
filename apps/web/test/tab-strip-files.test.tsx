import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fileTabFor } from "../src/canvas/canvas-store";
import { CodePane } from "../src/code/code-pane";
import { TabStripView } from "../src/shell/tab-strip";

const noop = () => undefined;

const html = (tab = fileTabFor("modules/local/x/main.nf")) =>
  renderToStaticMarkup(
    <TabStripView
      tabs={[tab]}
      activeTab={tab.id}
      controls={null}
      onSelect={noop}
      onMode={noop}
      onClose={noop}
    />,
  );

describe("F-210 file tabs", () => {
  it('F-210 UX-20 QA-10: a file tab has its path as title and a "Close <label>" button, no view-mode toggle, and the tablist is "Open workflows and files"', () => {
    const markup = html();
    expect(markup).toContain('aria-label="Open workflows and files"');
    expect(markup).toContain('title="modules/local/x/main.nf"');
    expect(markup).toContain('aria-label="Close x/main.nf"');
    expect(markup).not.toContain("view-mode");
  });

  it("F-210 UX-20 QA-10: the tablist holds only tabs; the close button is outside it", () => {
    const markup = html();
    const list = /<div role="tablist"[^>]*>(.*?)<\/div>/.exec(markup)?.[1];
    expect(list).toBeDefined();
    expect(list).not.toContain("workflow-tab-close");
    for (const button of (list as string).match(/<button[^>]*>/g) ?? [])
      expect(button).toContain('role="tab"');
    expect(markup).toContain("workflow-tab-close");
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
    expect(markup).not.toContain("Close ");
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
