import type {
  PaletteCategoryId,
  PaletteView,
  PaletteViewItem,
  Point,
} from "@nf-builder/engine";
import type { JSX, ReactNode } from "react";
import { PaletteCategorySection } from "./palette-category-section";
import { PaletteHeading } from "./palette-heading";

export function PaletteTree({
  view,
  open,
  searching,
  onToggle,
  onAdd,
  extra,
}: {
  readonly view: PaletteView;
  /** The categories that are open when not searching. */
  readonly open: readonly PaletteCategoryId[];
  readonly searching: boolean;
  readonly onToggle: (id: PaletteCategoryId) => void;
  readonly onAdd: (item: PaletteViewItem, at: Point | null) => void;
  /** Content after one category's own items: the "From plugins" list (F-505). */
  readonly extra?: {
    readonly category: PaletteCategoryId;
    readonly node: ReactNode;
  };
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
          extra={extra?.category === category.id ? extra.node : undefined}
        />
      ))}
    </section>
  );
}
