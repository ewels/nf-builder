import type { JSX, KeyboardEvent } from "react";
import { modeLabel, VIEW_MODES, type ViewMode } from "./view-mode";

/** The Graph, Split and Code switch of a tab (UX-27): a radio group with roving focus and arrow keys. */
export function ViewModeToggle({
  mode,
  labels = "workflow",
  onChange,
}: {
  readonly mode: ViewMode;
  /** Whose labels to show: a config tab reads Form, Split and Code (F-601). */
  readonly labels?: "workflow" | "config";
  readonly onChange: (mode: ViewMode) => void;
}): JSX.Element {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = VIEW_MODES.findIndex((m) => m.mode === mode);
    const last = VIEW_MODES.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const target = VIEW_MODES[targets[event.key] ?? -1];
    if (!target) return;
    event.preventDefault();
    onChange(target.mode);
    document.getElementById(`view-mode-${target.mode}`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className="view-mode-toggle"
      onKeyDown={move}
    >
      {VIEW_MODES.map((m) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control; a native radio can't be styled as a button (UX-27)
        <button
          key={m.mode}
          type="button"
          role="radio"
          id={`view-mode-${m.mode}`}
          className="view-mode-option"
          aria-checked={mode === m.mode}
          aria-keyshortcuts={m.key.toUpperCase()}
          title={`${modeLabel(labels, m.mode)} (${m.key.toUpperCase()})`}
          tabIndex={mode === m.mode ? 0 : -1}
          onClick={() => onChange(m.mode)}
        >
          {modeLabel(labels, m.mode)}
        </button>
      ))}
    </div>
  );
}
