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

/** The mode a tab shows: Graph only while the app is read-only, with the tab's own mode kept for when it widens (F-703, UX-04). */
export function shownMode(mode: ViewMode, readOnly: boolean): ViewMode {
  return readOnly ? "graph" : mode;
}

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .code-editor-host';

/** Whether typing into `target` is text entry, so a letter there is never a shortcut. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === "function" && el.closest(EDITABLE) !== null;
}

/** Whether `target` is inside a dialog, or a modal dialog is open anywhere, so the page behind it is inert (UX-70). */
function behindDialog(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  if (typeof el?.closest === "function" && el.closest("dialog") !== null)
    return true;
  return (
    typeof document !== "undefined" &&
    document.querySelector("dialog:modal") !== null
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

/** Whether a page shortcut must leave a key press alone: a repeat, a composition, already handled, text entry or a dialog. */
export function ignoredByShortcuts(e: ViewModeKey): boolean {
  return (
    e.repeat ||
    e.isComposing ||
    e.defaultPrevented ||
    isEditableTarget(e.target) ||
    behindDialog(e.target)
  );
}

/** The mode a key press switches to (UX-70), or null when the press is not a plain G, S or C outside text entry. */
export function viewModeForKey(e: ViewModeKey): ViewMode | null {
  if (e.ctrlKey || e.metaKey || e.altKey || ignoredByShortcuts(e)) return null;
  const key = e.key.toLowerCase();
  return VIEW_MODES.find((m) => m.key === key)?.mode ?? null;
}
