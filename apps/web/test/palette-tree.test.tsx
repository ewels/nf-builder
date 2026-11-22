import type {
  PaletteCategoryId,
  PaletteView,
  PaletteViewItem,
} from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaletteMessage } from "../src/palette/palette-message";
import { PalettePanel } from "../src/palette/palette-panel";
import { PaletteTree } from "../src/palette/palette-tree";

const item = (name: string, preview = false): PaletteViewItem => ({
  key: `operator:${name}`,
  kind: "operator",
  name,
  label: name,
  summary: `About ${name}.`,
  description: `About ${name}.`,
  keywords: [],
  icon: "operator",
  preview,
});

const view: PaletteView = {
  version: "99.01",
  categories: [
    {
      id: "processes",
      label: "Processes",
      icon: "process",
      items: [
        {
          ...item("agent", true),
          key: "agent",
          kind: "construct",
          icon: "agent",
        },
        { ...item("plain"), kind: "construct", key: "plain" },
      ],
      groups: [],
    },
    {
      id: "operators",
      label: "Operators",
      icon: "operator",
      items: [],
      groups: [
        { id: "transform", label: "Transform", items: [item("map")] },
        { id: "reduce", label: "Reduce", items: [item("groupBy")] },
      ],
    },
  ],
};

const render = (open: PaletteCategoryId[], searching = false) =>
  renderToStaticMarkup(
    <PaletteTree
      view={view}
      open={open}
      searching={searching}
      onToggle={() => {}}
    />,
  );

describe("palette tree", () => {
  it("F-204 UX-12: each category is a heading whose button has aria-expanded and aria-controls naming its panel; collapsed panels are hidden", () => {
    const html = render(["processes"]);
    expect(html).toMatch(
      /<h3[^>]*><button[^>]*aria-expanded="true"[^>]*aria-controls="palette-category-processes"[^>]*>[\s\S]*?Processes<\/button><\/h3>/,
    );
    expect(html).toMatch(
      /<button[^>]*aria-expanded="false"[^>]*aria-controls="palette-category-operators"/,
    );
    expect(html).toMatch(/<div id="palette-category-operators" hidden=""/);
    expect(html).not.toMatch(/<div id="palette-category-processes" hidden/);
  });

  it("F-204 UX-12: the Operators category renders one labelled list per group, in view order", () => {
    const html = render(["operators"]);
    const lists = [...html.matchAll(/<ul[^>]*aria-labelledby="([^"]+)"/g)];
    expect(lists).toHaveLength(2);
    expect(html.indexOf("Transform")).toBeLessThan(html.indexOf("Reduce"));
    for (const [, id] of lists) expect(html).toContain(`id="${id}"`);
  });

  it("F-204 UX-13: an item marked preview shows a preview badge and others none", () => {
    const html = render(["processes"]);
    expect(html.match(/badge-preview/g)).toHaveLength(1);
    expect(html).toMatch(/agent<\/span><span[^>]*badge-preview[^>]*>preview/);
  });

  it("F-204 UX-11: while searching, every category shown is open and its button is aria-disabled", () => {
    const html = render([], true);
    expect(html).not.toMatch(/ hidden=/);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(render([], false)).not.toContain("aria-disabled");
  });

  it("F-204 LA-02: the section heading shows the view's version", () => {
    expect(render([])).toContain("Nextflow language · 99.01");
  });

  it("F-204 UX-11: PaletteMessage renders the no-match text with the query in a status region; the load error uses an alert", () => {
    const status = renderToStaticMarkup(
      <PaletteMessage>No components match "zzzz".</PaletteMessage>,
    );
    expect(status).toMatch(/role="status"/);
    expect(status).toContain("No components match &quot;zzzz&quot;.");
    expect(
      renderToStaticMarkup(
        <PaletteMessage tone="error">Broken</PaletteMessage>,
      ),
    ).toMatch(/role="alert"/);
  });

  it('F-204: before the palette loads, PalettePanel shows "Loading components…" in a status region', () => {
    const html = renderToStaticMarkup(<PalettePanel languageVersion="26.10" />);
    expect(html).toMatch(/role="status"[^>]*>Loading components…/);
  });
});
