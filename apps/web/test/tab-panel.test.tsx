import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TabStripView } from "../src/shell/tab-strip";
import {
  PanelLayout,
  READ_ONLY_FILE_NOTE,
  ReadOnlyFileNote,
} from "../src/views/tab-panel";
import { shownMode } from "../src/views/view-mode";

const html = (mode: "graph" | "split" | "code") =>
  renderToStaticMarkup(
    <PanelLayout
      mode={mode}
      canvas={<div className="canvas-area" />}
      code={<section className="code-pane" />}
    />,
  );

describe("F-208 tab panel", () => {
  it("F-208 UX-27: Graph renders only the canvas, Code only the code pane, Split both with the graph first", () => {
    expect(html("graph")).toContain("canvas-area");
    expect(html("graph")).not.toContain("code-pane");
    expect(html("code")).toContain("code-pane");
    expect(html("code")).not.toContain("canvas-area");
    const split = html("split");
    expect(split.indexOf("canvas-area")).toBeGreaterThan(-1);
    expect(split.indexOf("canvas-area")).toBeLessThan(
      split.indexOf("code-pane"),
    );
    expect(split).toContain("view-divider");
  });

  it("F-309 UX-20: a file tab shows only the code pane, and the tab strip shows no view-mode toggle for it", () => {
    const file = {
      id: "file:nextflow.config",
      kind: "file",
      path: "nextflow.config",
      workflow: null,
      label: "nextflow.config",
      title: "nextflow.config",
      mode: "code",
      readOnly: null,
    } as const;
    // the panel lays a file tab out in Code mode, which has no canvas and no divider
    const panel = html(file.mode);
    expect(panel).toContain("code-pane");
    expect(panel).not.toContain("canvas-area");
    expect(panel).not.toContain("view-divider");
    const strip = (tab: typeof file | { kind: "workflow"; mode: "graph" }) =>
      renderToStaticMarkup(
        <TabStripView
          tabs={[{ ...file, ...tab }]}
          activeTab={file.id}
          controls={null}
          onSelect={() => undefined}
          onMode={() => undefined}
          onClose={() => undefined}
        />,
      );
    expect(strip(file)).not.toContain("view-mode");
    expect(strip(file)).toContain('title="nextflow.config"');
    expect(strip({ kind: "workflow", mode: "graph" })).toContain("view-mode");
  });

  it("F-703 UX-04 UX-27: read-only, the panel lays out the shown mode: only the graph, and the code pane is not built", () => {
    const layout = (mode: "graph" | "split" | "code", readOnly: boolean) =>
      renderToStaticMarkup(
        <PanelLayout
          mode={shownMode(mode, readOnly)}
          canvas={<div className="canvas-area" />}
          code={<section className="code-pane" />}
        />,
      );
    for (const mode of ["split", "code"] as const) {
      expect(layout(mode, true)).toContain("canvas-area");
      expect(layout(mode, true)).not.toContain("code-pane");
      expect(layout(mode, true)).not.toContain("view-divider");
    }
    expect(layout("split", false)).toContain("code-pane");
  });

  it("F-703 UX-04 UX-20: read-only, a code-only file tab shows a plain note instead of the code view or the canvas", () => {
    const markup = renderToStaticMarkup(<ReadOnlyFileNote />);
    expect(READ_ONLY_FILE_NOTE).toBe(
      "This file opens in the code view on screens 1024 px or wider.",
    );
    expect(markup).toContain(READ_ONLY_FILE_NOTE);
    expect(markup).not.toContain("code-pane");
    expect(markup).not.toContain("workflow-canvas");
  });
});
