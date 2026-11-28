import {
  type Diagnostic,
  nodeView,
  problemKey,
  problemsView,
  workflowSummary,
} from "@nf-builder/engine";
import type { JSX } from "react";
import {
  type CanvasContent,
  type DetailsContent,
  useWorkspace,
} from "../canvas/canvas-store";
import { problemsStore } from "../problems/problems-store";
import "./details.css";
import { FileDetails } from "./file-details";
import { NodeDetailsView } from "./node-details";
import { WorkflowSummaryView } from "./workflow-summary";

/** The details body for the canvas content, the selection and the worker's details (UX-30, UX-31). */
export function DetailsBody({
  content,
  selected,
  details,
  onShowProblems,
}: {
  readonly content: CanvasContent;
  readonly selected: string | null;
  readonly details: DetailsContent;
  readonly onShowProblems?: (first: Diagnostic) => void;
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
      <NodeDetailsView
        view={view}
        details={details}
        onShowProblems={onShowProblems}
      />
    </div>
  );
}

export function DetailsPane(): JSX.Element {
  const content = useWorkspace((s) => s.content);
  const selected = useWorkspace((s) => s.selected);
  const details = useWorkspace((s) => s.details);
  const file = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTab));
  if (file?.kind === "file") return <FileDetails path={file.path} />;
  return (
    <DetailsBody
      content={content}
      selected={selected}
      details={details}
      onShowProblems={(first) =>
        problemsStore.getState().show(problemsView(first), problemKey(first))
      }
    />
  );
}
