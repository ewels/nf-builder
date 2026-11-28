// The directive picker of the edit popup (F-303, UX-41, UX-70): a search box over the catalogue's directives. Typing
// filters by name and summary; the arrow keys move through the matches and Enter adds the active one.
import type { DirectiveChoice } from "@nf-builder/engine";
import { type JSX, type KeyboardEvent, useId, useMemo, useState } from "react";

export function DirectivePicker({
  choices,
  onPick,
}: {
  readonly choices: readonly DirectiveChoice[];
  readonly onPick: (choice: DirectiveChoice) => void;
}): JSX.Element {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return choices.filter((c) =>
      words.every(
        (w) =>
          c.name.toLowerCase().includes(w) ||
          c.summary.toLowerCase().includes(w),
      ),
    );
  }, [choices, query]);
  const current = Math.min(active, Math.max(matches.length - 1, 0));
  const optionId = (i: number) => `${id}-option-${i}`;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(current + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      // Enter here picks; it never submits the popup
      event.preventDefault();
      const choice = matches[current];
      if (choice !== undefined) onPick(choice);
    }
  };
  return (
    <div className="directive-picker">
      <label htmlFor={`${id}-search`} className="directive-picker-label">
        Add a directive
      </label>
      <input
        id={`${id}-search`}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          matches.length > 0 ? optionId(current) : undefined
        }
        placeholder="Search directives"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div id={listId} role="listbox" aria-label="Directives">
        {matches.map((choice, i) => (
          <div
            key={choice.name}
            id={optionId(i)}
            role="option"
            aria-selected={i === current}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(choice)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPick(choice);
              }
            }}
            tabIndex={-1}
          >
            <span className="directive-name">{choice.name}</span>
            <span className="directive-summary">{choice.summary}</span>
          </div>
        ))}
      </div>
      {matches.length === 0 ? (
        <p className="directive-none">No directives match.</p>
      ) : null}
    </div>
  );
}
