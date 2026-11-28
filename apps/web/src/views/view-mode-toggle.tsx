import type { JSX, KeyboardEvent } from "react";
import type { ModeOption, ViewMode } from "./view-mode";

/** The switch between the modes of a tab: Graph, Split and Code, or Preview, Split and Code, of a tab (UX-27): a radio group with roving focus and arrow keys. */
export function ViewModeToggle({
  modes,
  mode,
  onChange,
}: {
  readonly modes: readonly ModeOption[];
  readonly mode: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
}): JSX.Element {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = modes.findIndex((m) => m.mode === mode);
    const last = modes.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const target = modes[targets[event.key] ?? -1];
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
      {modes.map((m) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control; a native radio can't be styled as a button (UX-27)
        <button
          key={m.mode}
          type="button"
          role="radio"
          id={`view-mode-${m.mode}`}
          className="view-mode-option"
          aria-checked={mode === m.mode}
          aria-keyshortcuts={m.key.toUpperCase()}
          title={`${m.label} (${m.key.toUpperCase()})`}
          tabIndex={mode === m.mode ? 0 : -1}
          onClick={() => onChange(m.mode)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
