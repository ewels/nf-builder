import type { PaletteCategoryId, PaletteView } from "@nf-builder/engine";
import type { JSX } from "react";
import { PaletteCategorySection } from "./palette-category-section";

export function PaletteTree({
  view,
  open,
  searching,
  onToggle,
}: {
  readonly view: PaletteView;
  /** The categories that are open when not searching. */
  readonly open: readonly PaletteCategoryId[];
  readonly searching: boolean;
  readonly onToggle: (id: PaletteCategoryId) => void;
}): JSX.Element {
  return (
    <section aria-labelledby="palette-heading" className="palette-tree">
      <h2 id="palette-heading" className="palette-heading">
        Nextflow language · {view.version}
      </h2>
      {view.categories.map((category) => (
        <PaletteCategorySection
          key={category.id}
          category={category}
          expanded={open.includes(category.id)}
          searching={searching}
          onToggle={() => onToggle(category.id)}
        />
      ))}
    </section>
  );
}
