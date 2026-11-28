// The keys that act on the selected nodes (F-310, UX-70): Delete, and Ctrl/⌘+C and Ctrl/⌘+V. Edge keys stay with the
// canvas (`edge-keys.ts`, F-302). Pure: the platform and what is selected are passed in.
import { ignoredByShortcuts, type ViewModeKey } from "../views/view-mode";

export type CanvasKeyAction = "delete-nodes" | "copy" | "paste";

export interface CanvasKeyEvent extends ViewModeKey {
  readonly shiftKey: boolean;
}

export interface CanvasKeyContext {
  /** Below 1024 px (F-703): delete and paste are inert; copy writes nothing, so it works. */
  readonly readOnly: boolean;
  readonly apple: boolean;
  readonly nodesSelected: boolean;
  /** The document has selected text: the copy key is the browser's then. */
  readonly textSelected: boolean;
}

export function canvasKeyAction(
  e: CanvasKeyEvent,
  context: CanvasKeyContext,
): CanvasKeyAction | null {
  if (ignoredByShortcuts(e) || e.altKey) return null;
  if (e.key === "Delete" || e.key === "Backspace") {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return null;
    return context.nodesSelected && !context.readOnly ? "delete-nodes" : null;
  }
  const mod = context.apple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  if (key === "c")
    return context.nodesSelected && !context.textSelected ? "copy" : null;
  if (key === "v") return context.readOnly ? null : "paste";
  return null;
}
