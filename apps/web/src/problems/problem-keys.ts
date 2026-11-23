// Keyboard model of the problems list (F-309, UX-70, QA-11): one tab stop, roving between rows and between a row's buttons.
// Pure: the panel passes the rows in display order and the key.

export interface RowFocus {
  readonly key: string;
  readonly part: "go" | "fix";
}

interface FocusRow {
  readonly key: string;
  readonly fixable: boolean;
}

/**
 * Where a key moves the focus, or null for a key that isn't the list's. ArrowUp and ArrowDown move between rows (landing
 * on the go button, no wrapping), Home and End go to the first and last row, ArrowRight and ArrowLeft move between a row's
 * go and fix buttons. With no focus yet, a movement starts at the first row.
 */
export function nextRowFocus(
  rows: readonly FocusRow[],
  at: RowFocus | null,
  key: string,
): RowFocus | null {
  if (
    ![
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ].includes(key)
  )
    return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) return null;
  const go = (row: FocusRow): RowFocus => ({ key: row.key, part: "go" });
  const index = at === null ? -1 : rows.findIndex((r) => r.key === at.key);
  const here = rows[index];
  if (here === undefined || at === null) return go(first);
  switch (key) {
    case "Home":
      return go(first);
    case "End":
      return go(last);
    case "ArrowDown":
      return go(rows[Math.min(index + 1, rows.length - 1)] ?? here);
    case "ArrowUp":
      return go(rows[Math.max(index - 1, 0)] ?? here);
    case "ArrowRight":
      return here.fixable ? { key: here.key, part: "fix" } : at;
    default:
      return go(here);
  }
}

/**
 * The row to focus once `removed` has left the list: the one now in its place, else the one before, else null (the list).
 * Null too when `removed` was not in `before`.
 */
export function focusAfterRemoval(
  before: readonly string[],
  after: readonly string[],
  removed: string,
): string | null {
  const index = before.indexOf(removed);
  if (index < 0) return null;
  const kept = new Set(after);
  for (let i = index + 1; i < before.length; i++) {
    const key = before[i];
    if (key !== undefined && kept.has(key)) return key;
  }
  for (let i = index - 1; i >= 0; i--) {
    const key = before[i];
    if (key !== undefined && kept.has(key)) return key;
  }
  return null;
}

/**
 * Where the focus goes once a fix has settled and the list has changed: the fixed row's own fix button when the row is
 * still listed (the fix was refused), else the row in its place or the one before, else null (the list).
 */
export function focusAfterFix(
  before: readonly string[],
  after: readonly string[],
  fixed: string,
): RowFocus | null {
  if (after.includes(fixed)) return { key: fixed, part: "fix" };
  const next = focusAfterRemoval(before, after, fixed);
  return next === null ? null : { key: next, part: "go" };
}
