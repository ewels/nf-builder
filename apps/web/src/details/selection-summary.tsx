// The details of several selected nodes (F-310, UX-30): how many, which, and what to do with them.
import type { JSX } from "react";

import { DetailsActions } from "./details-actions";

export function SelectionSummary({
  nodes,
  onSelect,
  onCopy,
  onDelete,
}: {
  readonly nodes: readonly { id: string; label: string; kind: string }[];
  /** Selects that node alone. */
  readonly onSelect: (id: string) => void;
  /** Left out where copy isn't offered. */
  readonly onCopy?: () => void;
  /** Left out where delete isn't offered (read-only, ADR 0056). */
  readonly onDelete?: () => void;
}): JSX.Element {
  return (
    <div className="details-summary" data-details-state="selection">
      <h3 className="details-name">{nodes.length} nodes selected</h3>
      <ul className="details-list">
        {nodes.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className="details-port-name details-node-link"
              onClick={() => onSelect(n.id)}
            >
              {n.label}
            </button>{" "}
            <span className="details-type">{n.kind}</span>
          </li>
        ))}
      </ul>
      <DetailsActions onCopy={onCopy} onDelete={onDelete} />
    </div>
  );
}
