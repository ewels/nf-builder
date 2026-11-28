// The Copy and Delete buttons of the node details and the selection summary (F-310, ADR 0056).
import type { JSX } from "react";

export function DetailsActions({
  onCopy,
  onDelete,
}: {
  /** Left out where copy isn't offered. */
  readonly onCopy?: () => void;
  /** Left out where delete isn't offered (read-only). */
  readonly onDelete?: () => void;
}): JSX.Element | null {
  if (onCopy === undefined && onDelete === undefined) return null;
  return (
    <div className="details-actions">
      {onCopy === undefined ? null : (
        <button type="button" className="details-action" onClick={onCopy}>
          Copy
        </button>
      )}
      {onDelete === undefined ? null : (
        <button type="button" className="details-action" onClick={onDelete}>
          Delete
        </button>
      )}
    </div>
  );
}
