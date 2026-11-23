// Keyboard shortcuts of undo and redo (F-209, UX-70). Pure: the platform is passed in.
import { ignoredByShortcuts, type ViewModeKey } from "../views/view-mode";

export type HistoryAction = "undo" | "redo";

export interface HistoryKeyEvent extends ViewModeKey {
  readonly shiftKey: boolean;
}

export const isApplePlatform = (platform: string): boolean =>
  /^(Mac|iPhone|iPad|iPod)/.test(platform);

/**
 * The action a key press asks for, or null. Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y on Windows and Linux; ⌘Z and ⇧⌘Z on Apple
 * platforms. Text fields, the code editor and dialogs keep their own keys.
 */
export function historyActionForKey(
  e: HistoryKeyEvent,
  apple: boolean,
): HistoryAction | null {
  if (e.altKey || ignoredByShortcuts(e)) return null;
  if (apple ? e.ctrlKey || !e.metaKey : e.metaKey || !e.ctrlKey) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && !apple && !e.shiftKey) return "redo";
  return null;
}

export function shortcutText(action: HistoryAction, apple: boolean): string {
  if (apple) return action === "undo" ? "⌘Z" : "⇧⌘Z";
  return action === "undo" ? "Ctrl+Z" : "Ctrl+Shift+Z";
}

/** The `aria-keyshortcuts` value: every key that does the action. */
export function ariaKeyShortcuts(
  action: HistoryAction,
  apple: boolean,
): string {
  if (apple) return action === "undo" ? "Meta+Z" : "Meta+Shift+Z";
  return action === "undo" ? "Control+Z" : "Control+Shift+Z Control+Y";
}
