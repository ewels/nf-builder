import type { JSX } from "react";
import { useWorkspace } from "../canvas/canvas-store";

/** The column heading; while a node is selected, Edit and Code beside it, disabled until the popup exists (UX-32). */
export function DetailsHeaderView({
  selected,
}: {
  readonly selected: boolean;
}): JSX.Element {
  const title = <h2 className="column-title">Details</h2>;
  if (!selected) return title;
  return (
    <div className="details-header">
      {title}
      <button
        type="button"
        className="details-action"
        disabled
        title="Opens the edit popup (not available yet)"
      >
        Edit
      </button>
      <button
        type="button"
        className="details-action"
        disabled
        title="Opens the code popup (not available yet)"
      >
        Code
      </button>
    </div>
  );
}

export function DetailsHeader(): JSX.Element {
  const selected = useWorkspace((s) => s.selected !== null);
  return <DetailsHeaderView selected={selected} />;
}
