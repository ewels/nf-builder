// One option of a config card (F-601, FI-02, FI-03): its label, its value and its flags.
import { type OptionRow, valueText } from "@nf-builder/engine";
import { type JSX, useId } from "react";

/** What every card and row needs from the page. */
export interface ConfigHandlers {
  readonly toggled: readonly string[];
  readonly selected: string | null;
  readonly onSelect: (key: string | null) => void;
  readonly onToggle: (key: string) => void;
  readonly onOpen: (path: string) => void;
}

/** The text a row shows for its value: the decoded value as written, else the code, else nothing. */
export const rowText = (row: OptionRow): string =>
  row.value !== null ? valueText(row.value) : (row.code ?? "");

/** The selection key of a pinned field that isn't set: its full option path. */
export const unsetKey = (names: readonly string[]): string =>
  `unset:${names.join(".")}`;

export function OptionRowView({
  row,
  handlers,
}: {
  readonly row: OptionRow;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const id = useId();
  const unknown = row.class === "unknown";
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field inside takes focus, which selects the row too
    <li
      className="config-row"
      data-option={row.label}
      data-class={row.class}
      data-selected={handlers.selected === row.key}
      onClick={() => handlers.onSelect(row.key)}
      onFocusCapture={() => handlers.onSelect(row.key)}
    >
      <label className="config-row-label" htmlFor={id}>
        {row.label}
      </label>
      <input
        id={id}
        className="config-row-value"
        readOnly
        value={rowText(row)}
        aria-describedby={`${id}-note`}
      />
      <span className="config-row-note" id={`${id}-note`}>
        {unknown ? (
          <span className="config-flag">
            <span aria-hidden="true">▲</span> Unknown option
          </span>
        ) : null}
        {row.occurrences > 1
          ? ` Set ${row.occurrences} times; the last one is used.`
          : ""}
      </span>
    </li>
  );
}

/** A pinned field the file doesn't set (FI-02). */
export function UnsetRowView({
  label,
  names,
  handlers,
}: {
  readonly label: string;
  /** The full option path. */
  readonly names: readonly string[];
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const id = useId();
  const rowKey = unsetKey(names);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field inside takes focus, which selects the row too
    <li
      className="config-row is-unset"
      data-option={label}
      onClick={() => handlers.onSelect(rowKey)}
      onFocusCapture={() => handlers.onSelect(rowKey)}
    >
      <label className="config-row-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="config-row-value"
        readOnly
        value=""
        placeholder="Not set"
      />
      <span className="config-row-note" />
    </li>
  );
}
