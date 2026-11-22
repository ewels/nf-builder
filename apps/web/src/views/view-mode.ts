// View modes of a workflow tab (F-208, UX-27, UX-70): the graph, the graph beside the file's code, or the code alone.
export type ViewMode = "graph" | "split" | "code";

export const VIEW_MODES: readonly {
  readonly mode: ViewMode;
  readonly label: string;
  readonly key: "g" | "s" | "c";
}[] = [
  { mode: "graph", label: "Graph", key: "g" },
  { mode: "split", label: "Split", key: "s" },
  { mode: "code", label: "Code", key: "c" },
];

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .monaco-editor';

/** Whether typing into `target` is text entry, so a letter there is never a shortcut. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  const closest = (target as { closest?: unknown }).closest;
  return (
    typeof closest === "function" &&
    (closest as (selector: string) => unknown).call(target, EDITABLE) !== null
  );
}

export interface ViewModeKey {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly defaultPrevented: boolean;
  readonly target: EventTarget | null;
}

/** The mode a key press switches to (UX-70), or null when the press is not a plain G, S or C outside text entry. */
export function viewModeForKey(e: ViewModeKey): ViewMode | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.repeat || e.isComposing || e.defaultPrevented) return null;
  if (isEditableTarget(e.target)) return null;
  const key = e.key.toLowerCase();
  return VIEW_MODES.find((m) => m.key === key)?.mode ?? null;
}
