import type { PaletteViewItem } from "@nf-builder/engine";
import type { JSX } from "react";
import { PaletteGlyph } from "./palette-glyph";
import { PreviewBadge } from "./preview-badge";

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
      {item.preview ? <PreviewBadge /> : null}
    </li>
  );
}
