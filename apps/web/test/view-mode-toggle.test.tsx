import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ViewModeToggle } from "../src/views/view-mode-toggle";

describe("F-208 view mode toggle", () => {
  it('F-208 step 1 UX-27 QA-11: the toggle is a radio group "View mode" with Graph, Split and Code, the current mode checked, and G, S, C shortcuts', () => {
    const html = renderToStaticMarkup(
      <ViewModeToggle mode="split" onChange={() => undefined} />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="View mode"');
    const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>(\w+)</g)];
    expect(radios.map((m) => m[1])).toEqual(["Graph", "Split", "Code"]);
    const flags = radios.map((m) => [
      /aria-checked="(\w+)"/.exec(m[0])?.[1],
      /aria-keyshortcuts="(\w)"/.exec(m[0])?.[1],
      /tabindex="(-?\d)"/.exec(m[0])?.[1],
      /title="([^"]+)"/.exec(m[0])?.[1],
    ]);
    expect(flags).toEqual([
      ["false", "G", "-1", "Graph (G)"],
      ["true", "S", "0", "Split (S)"],
      ["false", "C", "-1", "Code (C)"],
    ]);
  });
});
