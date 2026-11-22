import type { PaletteCategoryId, PaletteView } from "@nf-builder/engine";
import type { JSX } from "react";
import { PaletteCategorySection } from "./palette-category-section";

export function PaletteTree({
  view,
  expanded,
  searching,
  onToggle,
}: {
  readonly view: PaletteView;
  readonly expanded: Readonly<Record<PaletteCategoryId, boolean>>;
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
          expanded={expanded[category.id]}
          searching={searching}
          onToggle={() => onToggle(category.id)}
        />
      ))}
    </section>
  );
}
