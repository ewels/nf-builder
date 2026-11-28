import { fileEditorOf } from "../files/file-kinds";

// View modes of a tab (F-208, F-605, UX-27, UX-70): the visual pane (graph or preview), both beside the code, or the code alone.
export type ViewMode = "graph" | "preview" | "split" | "code";

export interface ModeOption {
  readonly mode: ViewMode;
  readonly label: string;
  readonly key: "g" | "s" | "c";
}

export const VIEW_MODES: readonly ModeOption[] = [
  { mode: "graph", label: "Graph", key: "g" },
  { mode: "split", label: "Split", key: "s" },
  { mode: "code", label: "Code", key: "c" },
];

export const MARKDOWN_MODES: readonly ModeOption[] = [
  { mode: "preview", label: "Preview", key: "g" },
  { mode: "split", label: "Split", key: "s" },
  { mode: "code", label: "Code", key: "c" },
];

/** A config tab shows its form where a workflow tab shows the graph (F-601, UX-27). */
export const CONFIG_MODES: readonly ModeOption[] = [
  { mode: "graph", label: "Form", key: "g" },
  { mode: "split", label: "Split", key: "s" },
  { mode: "code", label: "Code", key: "c" },
];

/** The modes a tab offers (UX-27): Graph, Split, Code for a workflow; Form, Split, Code for a config; Preview, Split, Code for Markdown; none for other files, which show code only. */
export function modesFor(
  kind: "workflow" | "file" | "config",
  path: string,
): readonly ModeOption[] {
  if (kind === "workflow") return VIEW_MODES;
  if (kind === "config") return CONFIG_MODES;
  return fileEditorOf(path) === "markdown" ? MARKDOWN_MODES : [];
}

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

/** The mode a key press switches to (UX-70), or null when the press is not a plain G, S or C outside text entry. The keys are positional: G, S and C pick the first, second and third of `modes`. */
export function viewModeForKey(
  e: ViewModeKey,
  modes: readonly ModeOption[] = VIEW_MODES,
): ViewMode | null {
  if (e.ctrlKey || e.metaKey || e.altKey || ignoredByShortcuts(e)) return null;
  const key = e.key.toLowerCase();
  return modes.find((m) => m.key === key)?.mode ?? null;
}
