import type { PaletteViewItem } from "@nf-builder/engine";
import type { JSX } from "react";
import { PaletteGlyph } from "./palette-glyph";

/** Not focusable or draggable yet: adding items arrives with F-301 (UX-15). */
export function PaletteItemRow({
  item,
}: {
  readonly item: PaletteViewItem;
}): JSX.Element {
  return (
    <li className="palette-item" title={item.summary}>
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
    </li>
  );
}
