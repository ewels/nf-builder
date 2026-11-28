import type { PluginPaletteGroup, PluginPaletteItem } from "@nf-builder/engine";
import { type JSX, useState } from "react";
import { GlyphIcon, PALETTE_GLYPHS } from "../glyphs";
import { ChevronIcon } from "../shell/icons";

/**
 * One plugin function, operator or factory (F-505, IO-33): a focusable button described by its summary (QA-11). It is
 * `aria-disabled` and not draggable, because nothing inserts it into a workflow yet; pressing it says so.
 */
export function PluginItemRow({
  item,
  onPress,
}: {
  readonly item: PluginPaletteItem;
  readonly onPress: (item: PluginPaletteItem) => void;
}): JSX.Element {
  const describedBy = `palette-item-${item.key.replace(/[^A-Za-z0-9_-]/g, "-")}-summary`;
  return (
    <li className="palette-item" title={item.signatures.join("\n")}>
      <button
        type="button"
        className="palette-item-button"
        aria-disabled="true"
        aria-describedby={describedBy}
        onClick={() => onPress(item)}
      >
        <GlyphIcon
          glyph={PALETTE_GLYPHS[item.kind]}
          className="palette-glyph"
        />
        <span className="palette-item-label is-code">{item.name}</span>
      </button>
      <span id={describedBy} className="visually-hidden">
        {item.summary}
        {item.signatures.map((s) => ` (${item.kind}) ${s}`).join("")}
      </span>
    </li>
  );
}

/** The "From plugins" list: the declared plugins' items, one sub-heading per plugin (F-505, IO-33, UX-11). */
export function PluginGroups({
  groups,
  searching,
  onPress,
}: {
  readonly groups: readonly PluginPaletteGroup[];
  readonly searching: boolean;
  readonly onPress: (item: PluginPaletteItem) => void;
}): JSX.Element | null {
  // session only: no stored format
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (groups.length === 0) return null;
  return (
    <div className="palette-group plugin-groups">
      <h4 className="palette-group-heading">From plugins</h4>
      {groups.map((group) => {
        const listId = `palette-plugin-${group.id}`;
        const open = searching || !collapsed.has(group.id);
        const title = group.approximate
          ? `${group.id} · spec from ${group.version}`
          : `${group.id} ${group.version}`;
        return (
          <div key={group.id} className="registry-group">
            <h5 className="registry-group-heading">
              <button
                type="button"
                className="palette-category-button registry-group-button"
                aria-expanded={open}
                aria-controls={listId}
                aria-disabled={searching ? "true" : undefined}
                onClick={() => {
                  if (searching) return;
                  setCollapsed((c) => {
                    const next = new Set(c);
                    if (!next.delete(group.id)) next.add(group.id);
                    return next;
                  });
                }}
              >
                <ChevronIcon direction={open ? "down" : "right"} />
                <span>{title}</span>
                <span className="registry-count">{group.items.length}</span>
              </button>
            </h5>
            <ul
              id={listId}
              className="palette-list"
              hidden={!open}
              aria-label={title}
            >
              {group.items.map((item) => (
                <PluginItemRow key={item.key} item={item} onPress={onPress} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
