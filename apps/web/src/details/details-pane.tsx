import { nodeView, workflowSummary } from "@nf-builder/engine";
import type { JSX } from "react";
import {
  type CanvasContent,
  type DetailsContent,
  useWorkspace,
} from "../canvas/canvas-store";
import "./details.css";
import { NodeDetailsView } from "./node-details";
import { WorkflowSummaryView } from "./workflow-summary";

/** The details body for the canvas content, the selection and the worker's details (UX-30, UX-31). */
export function DetailsBody({
  content,
  selected,
  details,
}: {
  readonly content: CanvasContent;
  readonly selected: string | null;
  readonly details: DetailsContent;
}): JSX.Element {
  if (content.status !== "ready")
    return <p className="muted">Nothing selected</p>;
  const { projection } = content;
  const view = selected === null ? null : nodeView(projection, selected);
  if (view === null)
    return (
      <div className="details-pane" data-details-state="summary">
        <WorkflowSummaryView summary={workflowSummary(projection)} />
      </div>
    );
  const state =
    details.status === "ready" || details.status === "unavailable"
      ? details.status
      : "loading";
  return (
    <div className="details-pane" data-details-state={state}>
      <NodeDetailsView view={view} details={details} />
    </div>
  );
}

export function DetailsPane(): JSX.Element {
  const content = useWorkspace((s) => s.content);
  const selected = useWorkspace((s) => s.selected);
  const details = useWorkspace((s) => s.details);
  return (
    <DetailsBody content={content} selected={selected} details={details} />
  );
}
