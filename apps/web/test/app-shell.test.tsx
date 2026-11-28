import { installedPackVersions } from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell, canvasCounts } from "../src/app-shell";
import { COLUMN_LIMITS } from "../src/layout/layout-store";
import { AppHeader } from "../src/shell/app-header";
import { SideColumn } from "../src/shell/side-column";

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
    expect(header).toMatch(/<button(?![^>]*disabled)[^>]*>Templates<\/button>/);
    for (const name of ["Import", "Export"])
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

  it("F-203 UX-01: Templates is enabled and opens the dialog on From a template", () => {
    const onTemplates = vi.fn();
    const tree = AppHeader({
      languageVersions: ["26.10"],
      projectControls: null,
      saveLabel: "Saved",
      saveFailed: null,
      storageWarning: null,
      storageNote: false,
      onTemplates,
    });
    const found: { disabled?: boolean; onClick?: () => void }[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== "object" || node === null) return;
      const props = (node as { props?: Record<string, unknown> }).props;
      if (!props) return;
      if (props.children === "Templates")
        found.push(props as { onClick?: () => void });
      walk(props.children);
    };
    walk(tree);
    expect(found).toHaveLength(1);
    expect(found[0]?.disabled).toBeFalsy();
    found[0]?.onClick?.();
    expect(onTemplates).toHaveBeenCalledTimes(1);
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
      positions: {},
      refit: true,
      notice: null,
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

  it('F-201 F-206: with no project the details column still reads "Nothing selected" under the Details heading', () => {
    const html = renderToStaticMarkup(<AppShell />);
    const column =
      /<aside[^>]*aria-label="Details"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? "";
    expect(column).toContain('<h2 class="column-title">Details</h2>');
    expect(column).toContain('<p class="muted">Nothing selected</p>');
    expect(column).not.toContain("Edit");
  });
});

describe("F-703 shell", () => {
  it("F-703 UX-04 UX-01: the read-only header shows the app name, project switcher and save state, with no Templates, Import, Export or version selector", () => {
    const html = renderToStaticMarkup(
      AppHeader({
        languageVersions: ["26.10"],
        projectControls: <span>switcher</span>,
        saveLabel: "Saved",
        saveFailed: null,
        storageWarning: null,
        storageNote: false,
        onTemplates: () => undefined,
        readOnly: true,
      }),
    );
    expect(html).toContain("nf-builder");
    expect(html).toContain("switcher");
    expect(html).toContain("Saved");
    for (const gone of ["Templates", "Import", "Export", "Nextflow version"])
      expect(html).not.toContain(gone);
    expect(html).not.toContain("header-actions");
  });

  it("F-703 UX-04 UX-02: a non-collapsible side column has no toggle and shows its body even when the stored layout is collapsed", () => {
    const html = renderToStaticMarkup(
      <SideColumn side="right" label="Details" header="H" collapsible={false}>
        body
      </SideColumn>,
    );
    expect(html).not.toContain("<button");
    expect(html).not.toContain("hidden");
    expect(html).toContain("body");
    expect(html).toContain("H");
  });

  it("F-201 F-703: editable, the shell's markup is unchanged apart from an empty status container after the header", () => {
    const html = renderToStaticMarkup(<AppShell />);
    expect(html).toContain(
      '</header><div class="read-only-note" role="status"></div><div class="app-columns"',
    );
    expect(html).toContain('<div class="app-shell">');
  });
});
