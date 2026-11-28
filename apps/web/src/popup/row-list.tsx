// A list of rows in the edit popup's Configure form (F-303, UX-41): a fieldset with a legend, a row per item with Remove
// (and Move up and Move down where order matters) and an Add button. A row the form can't model is shown as written.
import type { JSX, ReactNode } from "react";

const KEPT_ROW_NOTE = "Kept as written. Edit it in the Code tab.";

interface RowListProps<T> {
  readonly legend: string;
  /** The section's name in the buttons: "input" gives "Add input" and "Remove input name". */
  readonly noun: string;
  readonly rows: readonly T[];
  /** The row's name for the buttons' labels. */
  readonly label: (row: T, index: number) => string;
  /** The text of a row the form keeps as code; null for a row it edits. Left out for a list whose rows are all edited. */
  readonly code?: (row: T) => string | null;
  readonly render: (row: T, index: number) => ReactNode;
  readonly onRemove: (index: number) => void;
  /** Moves a row up (-1) or down (1); left out where the order doesn't matter. */
  readonly onMove?: (index: number, by: -1 | 1) => void;
  /** Appends a new row. */
  readonly onAdd: () => void;
  readonly addLabel?: string;
  readonly children?: ReactNode;
}

export function RowList<T>({
  legend,
  noun,
  rows,
  label,
  code,
  render,
  onRemove,
  onMove,
  onAdd,
  addLabel,
  children,
}: RowListProps<T>): JSX.Element {
  return (
    <fieldset className="popup-section">
      <legend>{legend}</legend>
      <ul className="popup-rows">
        {rows.map((row, i) => {
          const kept = code?.(row) ?? null;
          const name = label(row, i);
          return (
            // rows have no stable identity of their own; the draft is replaced as a whole on every change
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <li key={i} className="popup-row" data-kept={kept !== null}>
              {kept === null ? (
                render(row, i)
              ) : (
                <div className="popup-kept">
                  <code>{kept}</code>
                  <span className="popup-note">{KEPT_ROW_NOTE}</span>
                </div>
              )}
              {kept === null ? (
                <span className="popup-row-actions">
                  {onMove ? (
                    <>
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => onMove(i, -1)}
                      >
                        {`Move ${noun} ${name} up`}
                      </button>
                      <button
                        type="button"
                        disabled={i === rows.length - 1}
                        onClick={() => onMove(i, 1)}
                      >
                        {`Move ${noun} ${name} down`}
                      </button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => onRemove(i)}>
                    {`Remove ${noun} ${name}`}
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {children}
      <button type="button" className="popup-add" onClick={onAdd}>
        {addLabel ?? `Add ${noun}`}
      </button>
    </fieldset>
  );
}
