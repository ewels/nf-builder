import type { JSX } from "react";
import type { Crumb, WorkflowTab } from "./canvas-store";

/** The path from the entry workflow to the open one, each ancestor a button that opens its tab (F-307, UX-50, QA-11). */
export function Breadcrumb({
  tab,
  onOpen,
}: {
  readonly tab: WorkflowTab;
  readonly onOpen: (crumb: Crumb) => void;
}): JSX.Element | null {
  if (tab.kind !== "workflow") return null;
  return (
    <nav className="breadcrumb" aria-label="Workflow path">
      <ol>
        {(tab.trail ?? []).map((c) => (
          <li key={`${c.path}#${c.workflow ?? ""}`}>
            <button type="button" onClick={() => onOpen(c)}>
              {c.label}
            </button>
            <span aria-hidden="true"> › </span>
          </li>
        ))}
        <li aria-current="page">{tab.label}</li>
      </ol>
    </nav>
  );
}
