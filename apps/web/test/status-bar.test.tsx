import { installedPackVersions } from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StatusProblems } from "../src/shell/status-bar";
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
        diagnostics={null}
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

  const diagnostics = (over: Partial<StatusProblems> = {}): StatusProblems => ({
    status: "ready",
    counts: { errors: 0, warnings: 1, suggestions: 2, problems: 1 },
    open: null,
    onToggle: () => undefined,
    ...over,
  });
  const render = (d: StatusProblems | null, nodes: number | null = 7) =>
    renderToStaticMarkup(
      <StatusBar
        diagnostics={d}
        nodes={nodes}
        channels={nodes === null ? null : 10}
        languageVersion="26.10.7"
      />,
    );

  it("F-201 F-309 UX-03: without a project the counts are plain text, as in F-201's baseline", () => {
    const html = render(null, 0);
    expect(html).not.toContain("<button");
    expect(html).toContain("No problems");
    expect(html).toContain("No suggestions");
    expect(html).not.toContain("Checking");
  });

  it("F-309 UX-03: with a project the problems and suggestions counts are buttons controlling the problems panel, with aria-expanded and the errors and warnings in the problems title", () => {
    const html = render(diagnostics());
    expect(html).toMatch(
      /<button[^>]*aria-controls="problems-panel"[^>]*aria-expanded="false"[^>]*title="0 errors, 1 warning"[^>]*>[\s\S]*?1 problem<\/button>/,
    );
    expect(html).toContain("2 suggestions");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('data-diagnostics="ready"');
    const open = render(diagnostics({ open: "suggestions" }));
    const expanded = [...open.matchAll(/aria-expanded="(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(expanded).toEqual(["false", "true"]);
    // glyph: check at zero, a cross for errors, a triangle otherwise
    expect(
      render(
        diagnostics({
          counts: { errors: 0, warnings: 0, suggestions: 0, problems: 0 },
        }),
      ),
    ).toContain("No problems");
    expect(
      render(
        diagnostics({
          counts: { errors: 1, warnings: 1, suggestions: 0, problems: 2 },
        }),
      ),
    ).toMatch(/✕[\s\S]*2 problems/);
    expect(html).toMatch(/▲[\s\S]*1 problem/);
  });

  it('F-309 UX-03: before the first result the bar reads "Checking for problems…"; node and channel counts are hidden for a file tab', () => {
    const loading = render(diagnostics({ status: "loading" }));
    expect(loading).toContain("Checking for problems…");
    expect(loading).toContain('data-diagnostics="loading"');
    expect(loading).not.toContain("<button");
    const failed = render(
      diagnostics({ status: "failed", message: "worker gone" }),
    );
    expect(failed).toContain("Problems unavailable");
    expect(failed).toContain('title="worker gone"');
    const file = render(diagnostics(), null);
    expect(file).not.toContain("node");
    expect(file).not.toContain("channel");
    expect(file).toContain("Nextflow 26.10.7");
  });
});
