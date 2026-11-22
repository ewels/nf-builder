import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasErrorBoundary } from "../src/canvas/canvas-error-boundary";

describe("canvas error boundary", () => {
  it("F-205 QA-01: children render until one throws, then the reload message replaces them", () => {
    const boundary = new CanvasErrorBoundary({ children: "canvas" });
    expect(renderToStaticMarkup(boundary.render())).toBe("canvas");
    boundary.state = CanvasErrorBoundary.getDerivedStateFromError();
    expect(renderToStaticMarkup(boundary.render())).toContain(
      "The canvas couldn&#x27;t load. Reload the page.",
    );
  });
});
