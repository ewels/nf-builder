import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelLayout } from "../src/views/tab-panel";

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
});
