import {
  type Diagnostic,
  nodeView,
  problemKey,
  problemsView,
  type RegistryFolder,
  workflowSuggestions,
  workflowSummary,
} from "@nf-builder/engine";
import type { JSX } from "react";
import {
  type CanvasContent,
  type DetailsContent,
  useWorkspace,
} from "../canvas/canvas-store";
import { ConfigDetails } from "../config/config-details";
import {
  type DiagnosticsStatus,
  problemsStore,
  useProblems,
} from "../problems/problems-store";
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
  diagnostics,
  registry,
  configPath,
  onOpenConfig,
}: {
  readonly content: CanvasContent;
  readonly selected: string | null;
  readonly details: DetailsContent;
  readonly onShowProblems?: (first: Diagnostic) => void;
  /** The project's diagnostics at this revision; null while they are being pulled, left out when they failed (F-405). */
  readonly diagnostics?: readonly Diagnostic[] | null;
  /** The project's registry module folders, for the summary's registry list (F-405). */
  readonly registry?: readonly RegistryFolder[];
  /** The project's root `nextflow.config`, linked from the entry workflow's summary (F-601). */
  readonly configPath?: string;
  readonly onOpenConfig?: (path: string) => void;
}): JSX.Element {
  if (content.status !== "ready")
    return <p className="muted">Nothing selected</p>;
  const { projection } = content;
  const view = selected === null ? null : nodeView(projection, selected);
  if (view === null)
    return (
      <div className="details-pane" data-details-state="summary">
        <WorkflowSummaryView
          summary={workflowSummary(projection, registry)}
          suggestions={
            diagnostics === undefined || diagnostics === null
              ? diagnostics
              : workflowSuggestions(projection.workflow, diagnostics)
          }
          onShowSuggestions={onShowProblems}
          configPath={configPath}
          onOpenConfig={onOpenConfig}
        />
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

/**
 * What the summary shows of the diagnostics (F-405): undefined (the section is left out) when they failed, null (still
 * being pulled) unless they were made at the projection's revision, else the list.
 */
export function diagnosticsAt(
  content: CanvasContent,
  status: DiagnosticsStatus,
  revision: number | null,
  list: readonly Diagnostic[],
): readonly Diagnostic[] | null | undefined {
  if (status === "failed") return undefined;
  return content.status === "ready" && revision === content.revision
    ? list
    : null;
}

export function DetailsPane(): JSX.Element {
  const content = useWorkspace((s) => s.content);
  const selected = useWorkspace((s) => s.selected);
  const details = useWorkspace((s) => s.details);
  const configPath = useWorkspace((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    return tab?.kind === "config" ? tab.path : null;
  });
  const rootConfig = useWorkspace((s) =>
    s.summary?.files.some((f) => f.path === "nextflow.config")
      ? "nextflow.config"
      : undefined,
  );
  const openFile = useWorkspace((s) => s.openFile);
  const file = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTab));
  const status = useProblems((s) => s.status);
  const revision = useProblems((s) => s.revision);
  const list = useProblems((s) => s.diagnostics);
  const registry = useProblems((s) => s.registry);
  const diagnostics = diagnosticsAt(content, status, revision, list);
  if (configPath !== null) return <ConfigDetails path={configPath} />;
  if (file?.kind === "file") return <FileDetails path={file.path} />;
  return (
    <DetailsBody
      content={content}
      selected={selected}
      details={details}
      diagnostics={diagnostics}
      registry={registry}
      configPath={rootConfig}
      onOpenConfig={(path) => void openFile(path)}
      onShowProblems={(first) =>
        problemsStore.getState().show(problemsView(first), problemKey(first))
      }
    />
  );
}
