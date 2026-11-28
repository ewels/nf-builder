import type { JSX } from "react";
import { useWorkspace } from "../canvas/canvas-store";
import { useReadOnly } from "../read-only/read-only-store";

/** The column heading; while a node is selected, Edit and Code beside it, disabled until the popup exists (UX-32). */
export function DetailsHeaderView({
  selected,
  readOnly = false,
}: {
  readonly selected: boolean;
  /** Below 1024 px (F-703, UX-04): the popup buttons aren't offered. */
  readonly readOnly?: boolean;
}): JSX.Element {
  const title = <h2 className="column-title">Details</h2>;
  if (!selected || readOnly) return title;
  return (
    <div className="details-header">
      {title}
      {["Edit", "Code"].map((name) => (
        <button
          key={name}
          type="button"
          className="details-action"
          disabled
          title={`Opens the ${name.toLowerCase()} popup (not available yet)`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export function DetailsHeader(): JSX.Element {
  const selected = useWorkspace((s) => s.selected !== null);
  const readOnly = useReadOnly();
  return <DetailsHeaderView selected={selected} readOnly={readOnly} />;
}
