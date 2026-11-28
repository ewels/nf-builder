import type {
  PaletteViewCategory,
  PaletteViewItem,
  Point,
} from "@nf-builder/engine";
import type { JSX } from "react";
import { ChevronIcon } from "../shell/icons";
import { PaletteItemRow } from "./palette-item-row";

export function PaletteCategorySection({
  category,
  expanded,
  searching,
  onToggle,
  onAdd,
}: {
  readonly category: PaletteViewCategory;
  readonly expanded: boolean;
  readonly searching: boolean;
  readonly onToggle: () => void;
  readonly onAdd: (item: PaletteViewItem, at: Point | null) => void;
}): JSX.Element {
  const id = `palette-category-${category.id}`;
  const open = searching || expanded;
  return (
    <div className="palette-category">
      <h3 className="palette-category-heading">
        <button
          type="button"
          id={`${id}-button`}
          className="palette-category-button"
          aria-expanded={open}
          aria-controls={id}
          aria-disabled={searching ? "true" : undefined}
          onClick={() => {
            if (!searching) onToggle();
          }}
        >
          <ChevronIcon direction={open ? "down" : "right"} />
          {category.label}
        </button>
      </h3>
      <div id={id} hidden={!open}>
        {category.groups.length === 0 ? (
          <ul className="palette-list" aria-label={category.label}>
            {category.items.map((item) => (
              <PaletteItemRow key={item.key} item={item} onAdd={onAdd} />
            ))}
          </ul>
        ) : (
          category.groups.map((group) => {
            const headingId = `${id}-group-${group.id}`;
            return (
              <div key={group.id} className="palette-group">
                <h4 id={headingId} className="palette-group-heading">
                  {group.label}
                </h4>
                <ul
                  className="palette-list is-grid"
                  aria-labelledby={headingId}
                >
                  {group.items.map((item) => (
                    <PaletteItemRow key={item.key} item={item} onAdd={onAdd} />
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
