// The keys that act on an edge of the canvas (F-302, UX-70): React Flow's own edge selection stays off, so the canvas
// keeps its own.
export type EdgeKeyAction = "disconnect" | "select" | "clear";

export function edgeKeyAction(
  key: string,
  readOnly: boolean,
): EdgeKeyAction | null {
  if (readOnly) return null;
  if (key === "Delete" || key === "Backspace") return "disconnect";
  if (key === "Enter") return "select";
  if (key === "Escape") return "clear";
  return null;
}
