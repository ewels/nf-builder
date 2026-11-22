import { installedPackVersions } from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell, canvasCounts } from "../src/app-shell";
import { COLUMN_LIMITS } from "../src/layout/layout-store";

describe("@nf-builder/web", () => {
  it("ADR-0003: the entry module loads", () => {
    expect(AppShell).toBeTypeOf("function");
  });

  it("UX-01: the header shows the app name nf-builder", () => {
    const html = renderToStaticMarkup(<AppShell />);
    expect(html).toMatch(
      /<header[^>]*>[\s\S]*<h1[^>]*>nf-builder<\/h1>[\s\S]*<\/header>/,
    );
  });

  it("UX-02: three labelled columns sit under the header", () => {
    const html = renderToStaticMarkup(<AppShell />);
    const landmarks = [
      ...html.matchAll(/<(aside|main)[^>]*aria-label="([^"]+)"/g),
    ].map((m) => [m[1], m[2]]);
    expect(landmarks).toEqual([
      ["aside", "Components and files"],
      ["main", "Canvas and editor"],
      ["aside", "Details"],
    ]);
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<aside"));
  });
  it("UX-01 LA-02: the header has the project switcher, save state, Templates, Import and Export, and a Nextflow version selector listing exactly the engine's installed packs", () => {
    const html = renderToStaticMarkup(<AppShell />);
    const header = /<header[\s\S]*<\/header>/.exec(html)?.[0] ?? "";
    expect(header).toContain("No project");
    expect(header).toMatch(/<p[^>]*role="status"[^>]*>Nothing to save<\/p>/);
    for (const name of ["Templates", "Import", "Export"])
      expect(header).toMatch(
        new RegExp(`<button[^>]*disabled[^>]*>${name}</button>`),
      );
    expect(header).toContain('aria-label="Nextflow version"');
    const options = [...header.matchAll(/<option value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(options).toEqual([...installedPackVersions()]);
    expect(options.length).toBeGreaterThan(0);
  });

  it("UX-02: each side column has a vertical separator with its value, limits and aria-controls naming the column", () => {
    const html = renderToStaticMarkup(<AppShell />);
    const hrs = [...html.matchAll(/<hr[^>]*>/g)].map((m) => m[0]);
    expect(hrs).toHaveLength(2);
    const expected = [
      ["left", "256", "column-left"],
      ["right", "296", "column-right"],
    ] as const;
    expected.forEach(([side, now, id], i) => {
      const hr = hrs[i] ?? "";
      expect(hr).toContain('tabindex="0"');
      expect(hr).toContain('aria-orientation="vertical"');
      expect(hr).toContain(`aria-valuenow="${now}"`);
      expect(hr).toContain(`aria-valuemin="${COLUMN_LIMITS[side].min}"`);
      expect(hr).toContain(`aria-valuemax="${COLUMN_LIMITS[side].max}"`);
      expect(hr).toContain(`aria-controls="${id}"`);
      expect(html).toMatch(new RegExp(`<aside[^>]*id="${id}"`));
    });
  });

  it("UX-02: each side column has a collapse button that controls it and reports aria-expanded", () => {
    const html = renderToStaticMarkup(<AppShell />);
    for (const [id, name] of [
      ["column-left", "Collapse components and files"],
      ["column-right", "Collapse details"],
    ]) {
      const button =
        new RegExp(`<button[^>]*id="${id}-toggle"[^>]*>`).exec(html)?.[0] ?? "";
      expect(button).toContain('aria-expanded="true"');
      expect(button).toContain(`aria-controls="${id}-body"`);
      expect(button).toContain(`aria-label="${name}"`);
    }
  });

  it("UX-02: the centre column has a tab strip above the canvas area", () => {
    const html = renderToStaticMarkup(<AppShell />);
    const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
    expect(main.indexOf("tab-strip")).toBeGreaterThan(-1);
    expect(main.indexOf("tab-strip")).toBeLessThan(main.indexOf("canvas-area"));
  });

  it("UX-03: the status bar is a footer after the columns", () => {
    const html = renderToStaticMarkup(<AppShell />);
    expect(html.indexOf("<footer")).toBeGreaterThan(
      html.lastIndexOf("</aside>"),
    );
  });

  it("F-205 F-201: with no project the shell renders the 'No project open' placeholder and no tabs", () => {
    const html = renderToStaticMarkup(<AppShell />);
    const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
    expect(main).toContain("No project open");
    expect(main).toContain("No files open");
    expect(main).not.toContain('role="tab"');
    expect(main).not.toContain("tabpanel");
  });

  it("F-205 UX-03: the status bar counts the active canvas's nodes and channels", () => {
    const range = {
      start: 0,
      end: 0,
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
    };
    const node = (id: string) =>
      ({
        id,
        kind: "params",
        label: "params",
        inputs: [],
        outputs: [],
        range,
        guards: [],
      }) as const;
    const edge = {
      id: "e",
      from: { node: "a", port: "x" },
      to: { node: "b", port: "y" },
      type: { dataflow: "channel", element: null },
      variable: null,
      direct: true,
    } as const;
    const counts = canvasCounts({
      status: "ready",
      revision: 1,
      projection: {
        workflow: {
          path: "main.nf",
          name: null,
          modelled: true,
          typed: true,
          range,
        },
        nodes: [node("a"), node("b"), node("c")],
        edges: [edge, { ...edge, id: "f" }],
        statements: [],
      },
    });
    expect(counts).toEqual({ nodes: 3, channels: 2 });
    expect(canvasCounts({ status: "empty" })).toEqual({
      nodes: 0,
      channels: 0,
    });
  });
});
