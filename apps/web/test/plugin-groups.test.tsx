import type { PluginPaletteGroup, PluginPaletteItem } from "@nf-builder/engine";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PluginGroups, PluginItemRow } from "../src/palette/plugin-groups";

const item = (name: string, kind: PluginPaletteItem["kind"] = "function") => ({
  key: `plugin:nf-schema:${kind}:${name}`,
  kind,
  name,
  summary: `About ${name}.`,
  description: `About ${name}.`,
  signatures: [`${name}(String) -> List`],
});
const group = (over: Partial<PluginPaletteGroup> = {}): PluginPaletteGroup => ({
  id: "nf-schema",
  version: "3.1.0",
  approximate: false,
  items: [item("samplesheetToList"), item("validateParameters")],
  ...over,
});
const find = (node: ReactNode, type: string): ReactElement | null => {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === type) return el;
  for (const child of [el.props.children].flat()) {
    const hit = find(child as ReactNode, type);
    if (hit) return hit;
  }
  return null;
};

describe("F-505 plugin palette groups", () => {
  it("F-505 QA-11 IO-33: plugin palette items are focusable, described by their summary and aria-disabled", () => {
    const html = renderToStaticMarkup(
      <PluginGroups groups={[group()]} searching={false} onPress={() => {}} />,
    );
    expect(html).toContain("From plugins");
    expect(html).toContain("nf-schema 3.1.0");
    expect(html).toContain("samplesheetToList");
    expect(html).toContain("validateParameters");
    const buttons = html.match(/<button[^>]*palette-item-button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b).toContain('aria-disabled="true"');
      expect(b).not.toContain("draggable");
      expect(b).toMatch(/aria-describedby="[^"]+"/);
    }
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(
      `<span id="${describedBy}" class="visually-hidden">About samplesheetToList.`,
    );
    expect(html).toContain("(function) samplesheetToList(String) -&gt; List");
  });

  it("F-505 IO-33: pressing an item reports it, so the palette can say it can't be added yet", () => {
    const pressed: string[] = [];
    const row = PluginItemRow({
      item: item("map", "operator"),
      onPress: (i) => void pressed.push(i.name),
    });
    const button = find(row, "button") as ReactElement<{ onClick: () => void }>;
    button.props.onClick();
    expect(pressed).toEqual(["map"]);
  });

  it("F-505 IO-33: an approximate group names the release its spec is from; nothing renders without groups", () => {
    expect(
      renderToStaticMarkup(
        <PluginGroups
          groups={[group({ approximate: true })]}
          searching={false}
          onPress={() => {}}
        />,
      ),
    ).toContain("spec from 3.1.0");
    expect(
      renderToStaticMarkup(
        <PluginGroups groups={[]} searching={false} onPress={() => {}} />,
      ),
    ).toBe("");
  });
});
