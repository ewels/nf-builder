import { installedPackVersions } from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatCount, StatusBar } from "../src/shell/status-bar";

describe("status bar", () => {
  it('UX-03: counts read "No problems", "1 problem", "2 problems", and likewise for suggestions, nodes and channels', () => {
    expect(formatCount(0, "problem", "problems", "No problems")).toBe(
      "No problems",
    );
    expect(formatCount(1, "problem", "problems", "No problems")).toBe(
      "1 problem",
    );
    expect(formatCount(2, "problem", "problems", "No problems")).toBe(
      "2 problems",
    );
    expect(formatCount(0, "suggestion", "suggestions", "No suggestions")).toBe(
      "No suggestions",
    );
    expect(formatCount(1, "suggestion", "suggestions", "No suggestions")).toBe(
      "1 suggestion",
    );
    expect(formatCount(0, "node", "nodes")).toBe("0 nodes");
    expect(formatCount(1, "channel", "channels")).toBe("1 channel");
    expect(formatCount(3, "channel", "channels")).toBe("3 channels");
  });

  it("UX-03: the status bar shows problems, suggestions, node and channel counts, then the language version", () => {
    const version = installedPackVersions()[0];
    const html = renderToStaticMarkup(
      <StatusBar
        problems={0}
        suggestions={0}
        nodes={0}
        channels={0}
        languageVersion={version}
      />,
    );
    const order = [
      "No problems",
      "No suggestions",
      "0 nodes",
      "0 channels",
      `Nextflow ${version}`,
    ].map((t) => html.indexOf(t));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/^<footer/);
  });
});
