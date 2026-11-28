import type { FileTreeRow } from "@nf-builder/engine";
import type { JSX, KeyboardEvent } from "react";
import { ChevronIcon, GlyphIcon } from "../shell/icons";

/** What a badge says: the error count when there is one, else (a verbatim or partial parse with no problem) a neutral note. */
const parseErrors = (n: number): string =>
  n === 0
    ? "Not fully parsed"
    : n === 1
      ? "1 parse error"
      : `${n} parse errors`;

/**
 * The project's files as a WAI-ARIA tree (UX-16, QA-10): flat rows with their level, set size and position; one row is in
 * the tab order and selection follows focus. Presentational: the keys and the actions are the panel's (AR-31).
 */
export function FileTree({
  rows,
  selected,
  dropTarget = null,
  onSelect,
  onActivate,
  onKeyDown,
}: {
  readonly rows: readonly FileTreeRow[];
  readonly selected: string | null;
  /** The folder a file drag is over, for a highlight. */
  readonly dropTarget?: string | null;
  readonly onSelect: (path: string) => void;
  readonly onActivate: (row: FileTreeRow) => void;
  readonly onKeyDown?: (
    event: KeyboardEvent<HTMLUListElement>,
    focused: string | null,
  ) => void;
}): JSX.Element {
  // the selected row is the tab stop; with none visible, the first
  const stop = rows.some((r) => r.path === selected)
    ? selected
    : (rows[0]?.path ?? null);
  return (
    <ul
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the WAI-ARIA tree pattern: a list of treeitems
      role="tree"
      aria-label="Project files"
      className="file-tree"
      onKeyDown={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-path]",
        );
        onKeyDown?.(event, row?.dataset.path ?? null);
      }}
    >
      {rows.map((row) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled once on the tree (WAI-ARIA tree pattern)
        <li
          key={row.path}
          role="treeitem"
          className={`file-row${row.kind === "folder" ? " is-folder" : ""}${row.path === dropTarget ? " is-drop-target" : ""}`}
          data-path={row.path}
          aria-level={row.level}
          aria-setsize={row.setSize}
          aria-posinset={row.posInSet}
          aria-selected={row.path === selected}
          aria-expanded={
            row.kind === "folder" ? row.expanded === true : undefined
          }
          tabIndex={row.path === stop ? 0 : -1}
          style={{ paddingInlineStart: `${(row.level - 1) * 14 + 4}px` }}
          onFocus={(event) => {
            if (event.target === event.currentTarget) onSelect(row.path);
          }}
          onClick={() => onActivate(row)}
        >
          <span className="file-chevron">
            {row.kind === "folder" ? (
              <ChevronIcon direction={row.expanded ? "down" : "right"} />
            ) : null}
          </span>
          <GlyphIcon name={row.kind === "folder" ? "folder" : "file"} />
          <span className="file-name">{row.name}</span>
          {row.registry === null ? null : (
            <span
              className="file-tag"
              title={`Registry module ${row.registry}`}
            >
              registry
            </span>
          )}
          {row.failed ? (
            <span
              className="file-badge"
              title={`This file doesn't parse completely: ${parseErrors(row.problems).toLowerCase()}.`}
            >
              <GlyphIcon name="error" />
              <span className="visually-hidden">
                {parseErrors(row.problems)}
              </span>
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
