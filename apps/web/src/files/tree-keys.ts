// The Files tree's keyboard model (UX-70, QA-10): the WAI-ARIA tree pattern as a pure function of the visible rows.
import type { FileTreeRow } from "@nf-builder/engine";

export const TYPEAHEAD_RESET_MS = 500;

/** The type-ahead buffer: what was typed and when the last character came. */
export interface TypeAhead {
  readonly text: string;
  readonly at: number;
}

export type TreeKeyAction =
  | {
      readonly kind: "focus" | "expand" | "collapse" | "open" | "toggle";
      readonly path: string;
    }
  | { readonly kind: "none" };

const NONE: TreeKeyAction = { kind: "none" };
const focusOn = (row: FileTreeRow | undefined): TreeKeyAction =>
  row === undefined ? NONE : { kind: "focus", path: row.path };

/**
 * What a key does in the tree. Ctrl, Meta and Alt combinations are not handled, so undo and redo pass through. Handled
 * keys reset the type-ahead buffer; unhandled keys leave it alone.
 */
export function treeKey(
  rows: readonly FileTreeRow[],
  focused: string | null,
  key: {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly altKey: boolean;
  },
  typeAhead: TypeAhead,
  now: number,
): { readonly action: TreeKeyAction; readonly typeAhead: TypeAhead } {
  const unhandled = { action: NONE, typeAhead };
  if (key.ctrlKey || key.metaKey || key.altKey) return unhandled;
  const index = rows.findIndex((r) => r.path === focused);
  const current = rows[index];
  const handled = (action: TreeKeyAction) => ({
    action,
    typeAhead: { text: "", at: now },
  });
  switch (key.key) {
    case "ArrowDown":
      return handled(focusOn(rows[index + 1]));
    case "ArrowUp":
      return handled(focusOn(index < 0 ? rows[0] : rows[index - 1]));
    case "Home":
      return handled(focusOn(rows[0]));
    case "End":
      return handled(focusOn(rows.at(-1)));
    case "ArrowRight": {
      if (current?.kind !== "folder") return handled(NONE);
      if (!current.expanded)
        return handled({ kind: "expand", path: current.path });
      const next = rows[index + 1];
      return handled(next?.parent === current.path ? focusOn(next) : NONE);
    }
    case "ArrowLeft": {
      if (current === undefined) return handled(NONE);
      if (current.kind === "folder" && current.expanded)
        return handled({ kind: "collapse", path: current.path });
      return handled(focusOn(rows.find((r) => r.path === current.parent)));
    }
    case "Enter":
      if (current === undefined) return handled(NONE);
      return handled({
        kind: current.kind === "folder" ? "toggle" : "open",
        path: current.path,
      });
  }
  if (key.key.length !== 1) return unhandled;
  const fresh = now - typeAhead.at > TYPEAHEAD_RESET_MS;
  const text = (fresh ? "" : typeAhead.text) + key.key;
  const wanted = text.toLowerCase();
  // a first character looks from the next row; a longer buffer narrows from the focused row itself
  const start = text.length === 1 ? index + 1 : Math.max(index, 0);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[(start + i) % rows.length];
    if (row?.name.toLowerCase().startsWith(wanted))
      return { action: focusOn(row), typeAhead: { text, at: now } };
  }
  return { action: NONE, typeAhead: { text, at: now } };
}
