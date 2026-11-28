import type { PaletteViewItem } from "@nf-builder/engine";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { canvasStore } from "../src/canvas/canvas-store";
import { registerViewport } from "../src/canvas/viewport";
import { PaletteItemRow } from "../src/palette/palette-item-row";

const item = (key: string, label = key): PaletteViewItem => ({
  key,
  kind: key === "process" ? "construct" : "operator",
  name: label,
  label,
  summary: `About ${label}.`,
  description: `About ${label}.`,
  keywords: [],
  icon: "operator",
  preview: false,
});

/** The first element of a rendered tree whose type is `type`. */
function find(node: ReactNode, type: string): ReactElement | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ type?: string; children?: ReactNode }>;
  if (el.type === type) return el;
  for (const child of [el.props.children].flat())
    if (child !== undefined) {
      const hit = find(child as ReactNode, type);
      if (hit) return hit;
    }
  return null;
}

describe("F-301 palette item row", () => {
  it("F-301 QA-11 UX-15: an addable item is a focusable draggable button described by its summary; others are aria-disabled and not draggable", () => {
    const html = (i: PaletteViewItem) =>
      renderToStaticMarkup(<PaletteItemRow item={i} onAdd={() => undefined} />);
    const addable = html(item("process", "Process"));
    expect(addable).toMatch(/<button[^>]*type="button"/);
    expect(addable).toMatch(/<button[^>]*draggable="true"/);
    expect(addable).not.toMatch(/aria-disabled/);
    const describedBy = /aria-describedby="([^"]+)"/.exec(addable)?.[1];
    expect(describedBy).toBeDefined();
    expect(addable).toContain(
      `<span id="${describedBy}" class="visually-hidden">About Process.</span>`,
    );
    const other = html(item("operator:map", "map"));
    expect(other).toMatch(/<button[^>]*aria-disabled="true"/);
    expect(other).not.toMatch(/draggable="true"/);
    expect(other).toContain("About map.");
  });

  it("F-301 UX-70: Enter on an item calls add with the viewport centre", () => {
    const calls: unknown[] = [];
    canvasStore.setState({ activeTab: "main.nf#" });
    const unregister = registerViewport({
      tab: "main.nf#",
      centre: () => ({ x: 120, y: 80 }),
      toFlow: (p) => p,
    });
    const button = find(
      PaletteItemRow({
        item: item("process"),
        onAdd: (...args) => void calls.push(args),
      }),
      "button",
    );
    if (button === null) throw new Error("no button");
    const click = (button.props as unknown as { onClick: () => void }).onClick;
    click();
    unregister();
    click();
    expect(calls).toEqual([
      [item("process"), { x: 120, y: 80 }],
      [item("process"), null],
    ]);
    canvasStore.setState({ activeTab: null });
  });

  it("F-301 UX-70 QA-11: Enter and Space add through the button's native activation, with no key handler that could add twice", () => {
    const button = find(
      PaletteItemRow({ item: item("process"), onAdd: () => undefined }),
      "button",
    );
    if (button === null) throw new Error("no button");
    const props = button.props as Record<string, unknown>;
    // a browser turns Enter and Space on a focused button into its click; a key handler as well would add twice
    expect(button.type).toBe("button");
    expect(props.type).toBe("button");
    expect(props.onClick).toBeTypeOf("function");
    expect(props.onKeyDown).toBeUndefined();
    expect(props.onKeyUp).toBeUndefined();
    expect(props.onKeyPress).toBeUndefined();
  });
});
