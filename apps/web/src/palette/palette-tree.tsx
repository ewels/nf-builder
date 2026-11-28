import type {
  PaletteCategoryId,
  PaletteView,
  PaletteViewItem,
  Point,
} from "@nf-builder/engine";
import type { JSX } from "react";
import { PaletteCategorySection } from "./palette-category-section";
import { PaletteHeading } from "./palette-heading";

export function PaletteTree({
  view,
  open,
  searching,
  onToggle,
  onAdd,
}: {
  readonly view: PaletteView;
  /** The categories that are open when not searching. */
  readonly open: readonly PaletteCategoryId[];
  readonly searching: boolean;
  readonly onToggle: (id: PaletteCategoryId) => void;
  readonly onAdd: (item: PaletteViewItem, at: Point | null) => void;
}): JSX.Element {
  return (
    <section aria-labelledby="palette-heading" className="palette-tree">
      <PaletteHeading version={view.version} />
      {view.categories.map((category) => (
        <PaletteCategorySection
          key={category.id}
          category={category}
          expanded={open.includes(category.id)}
          searching={searching}
          onToggle={() => onToggle(category.id)}
          onAdd={onAdd}
        />
      ))}
    </section>
  );
}
