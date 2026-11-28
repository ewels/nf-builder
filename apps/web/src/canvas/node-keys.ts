// The keyboard way into the edit popup (F-303, UX-40, UX-70): Enter on a node that is already selected. The first Enter
// on a focused node only selects it (React Flow), as F-206's test expects.

/** The node to open for a key press: the focused node, when `key` is Enter and it is the selected one; else null. */
export function opensPopup(
  event: { readonly key: string; readonly target: EventTarget | null },
  selected: string | null,
): string | null {
  if (event.key !== "Enter" || selected === null) return null;
  const target = event.target as HTMLElement | null;
  // a key typed in a field or pressed on a control is that control's
  if (target?.closest?.("input, textarea, select, button, [contenteditable]"))
    return null;
  const id = target?.closest?.(".react-flow__node")?.getAttribute("data-id");
  return id === selected ? selected : null;
}

/**
 * Opens a node, by double-click or Enter on the selected one: a workflow call opens its canvas tab (F-307, UX-50, also
 * read-only), anything else its edit popup, which read-only has none of (F-303, UX-40, F-703).
 */
export function openNode(
  opens: boolean,
  id: string,
  opener: HTMLElement | null,
  handlers: {
    readonly onOpenCallee: (id: string) => void;
    readonly onOpenNode?: (id: string, opener: HTMLElement | null) => void;
  },
): void {
  if (opens) handlers.onOpenCallee(id);
  else handlers.onOpenNode?.(id, opener);
}
