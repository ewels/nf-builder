import type { PaletteViewItem } from "@nf-builder/engine";
import { type Point, paletteAction } from "@nf-builder/engine";
import type { JSX } from "react";
import { canvasStore } from "../canvas/canvas-store";
import { activeViewport } from "../canvas/viewport";
import { writePaletteDrag } from "./palette-drag";
import { PaletteGlyph } from "./palette-glyph";

/**
 * A focusable button: Enter (or Space, or a click) adds the item at the viewport centre, a drag onto the canvas at the
 * pointer (F-301, UX-15, UX-70). Its summary is its accessible description (QA-11, F-204 note). Items with no action yet
 * stay focusable for their description, `aria-disabled`, and say so when pressed.
 */
export function PaletteItemRow({
  item,
  onAdd,
}: {
  readonly item: PaletteViewItem;
  readonly onAdd: (item: PaletteViewItem, at: Point | null) => void;
}): JSX.Element {
  const addable = paletteAction(item) !== null;
  const describedBy = `palette-item-${item.key.replace(/[^A-Za-z0-9_-]/g, "-")}-summary`;
  return (
    <li className="palette-item" title={item.summary}>
      <button
        type="button"
        className="palette-item-button"
        draggable={addable}
        aria-disabled={addable ? undefined : "true"}
        aria-describedby={describedBy}
        onClick={() =>
          onAdd(
            item,
            activeViewport(canvasStore.getState().activeTab ?? "")?.centre() ??
              null,
          )
        }
        onDragStart={(event) => {
          if (addable) writePaletteDrag(event.dataTransfer, item.key);
          else event.preventDefault();
        }}
      >
        <PaletteGlyph icon={item.icon} />
        <span
          className={`palette-item-label${item.kind === "construct" ? "" : " is-code"}`}
        >
          {item.label}
        </span>
        {item.preview ? (
          <span
            className="badge-preview"
            title="Preview feature: it may change in a later Nextflow release"
          >
            preview
          </span>
        ) : null}
      </button>
      <span id={describedBy} className="visually-hidden">
        {item.summary}
      </span>
    </li>
  );
}
