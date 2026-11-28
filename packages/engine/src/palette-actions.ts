import type { PaletteViewItem } from "@nf-builder/lang-core";

/** What adding a palette item to the canvas does (F-301, UX-15). */
export type PaletteAction = { kind: "process" } | { kind: "workflow" };

/** The action of a palette item, or null while the item can't be added from the palette yet. */
export function paletteAction(
  item: Pick<PaletteViewItem, "key">,
): PaletteAction | null {
  switch (item.key) {
    case "process":
      return { kind: "process" };
    case "workflow":
      return { kind: "workflow" };
    default:
      return null;
  }
}
