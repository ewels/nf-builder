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
  canvasStore,
  type DetailsContent,
  useWorkspace,
} from "../canvas/canvas-store";
import { activeViewport } from "../canvas/viewport";
import { ConfigDetails } from "../config/config-details";
import {
  type DiagnosticsStatus,
  problemsStore,
  useProblems,
} from "../problems/problems-store";
import { useReadOnly } from "../read-only/read-only-store";
import "./details.css";
import { FileDetails } from "./file-details";
import { NodeDetailsView } from "./node-details";
import { SelectionSummary } from "./selection-summary";
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
  onAddPort,
  selection = [],
  onSelectNode,
  onCopy,
  onDelete,
  pasteNodes = null,
  onPaste,
}: {
  readonly content: CanvasContent;
  readonly selected: string | null;
  readonly details: DetailsContent;
  /** The selected nodes' ids; two or more show the selection summary (F-310, UX-30). */
  readonly selection?: readonly string[];
  readonly onSelectNode?: (id: string) => void;
  /** Left out where copy isn't offered. */
  readonly onCopy?: () => void;
  /** Left out where delete isn't offered: read-only (F-310, ADR 0056). */
  readonly onDelete?: () => void;
  /** The nodes on the clipboard, or null when it is empty or paste isn't offered. */
  readonly pasteNodes?: number | null;
  readonly onPaste?: () => void;
  readonly onShowProblems?: (first: Diagnostic) => void;
  /** The project's diagnostics at this revision; null while they are being pulled, left out when they failed (F-405). */
  readonly diagnostics?: readonly Diagnostic[] | null;
  /** The project's registry module folders, for the summary's registry list (F-405). */
  readonly registry?: readonly RegistryFolder[];
  /** The project's root `nextflow.config`, linked from the entry workflow's summary (F-601). */
  readonly configPath?: string;
  readonly onOpenConfig?: (path: string) => void;
  /** Adds a take or an emit to the open workflow; left out read-only (F-307, F-703). */
  readonly onAddPort?: (
    role: "take" | "emit",
    name: string,
    type: string | null,
  ) => Promise<string | null>;
}): JSX.Element {
  if (content.status !== "ready")
    return <p className="muted">Nothing selected</p>;
  const { projection } = content;
  if (selection.length >= 2) {
    const nodes = selection.flatMap((id) => {
      const v = nodeView(projection, id);
      return v === null ? [] : [{ id, label: v.name, kind: v.kindLabel }];
    });
    return (
      <div className="details-pane">
        <SelectionSummary
          nodes={nodes}
          onSelect={(id) => onSelectNode?.(id)}
          onCopy={onCopy}
          onDelete={onDelete}
        />
      </div>
    );
  }
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
          onAddPort={onAddPort}
          pasteNodes={pasteNodes}
          onPaste={onPaste}
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
        onCopy={onCopy}
        onDelete={onDelete}
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

/** Where a button's paste lands: the centre of the visible canvas, or the layout's choice when none is mounted. */
const centreOfCanvas = () => {
  const { activeTab } = canvasStore.getState();
  return activeViewport(activeTab ?? "")?.centre() ?? null;
};

export function DetailsPane(): JSX.Element {
  const content = useWorkspace((s) => s.content);
  const selected = useWorkspace((s) => s.selected);
  const selection = useWorkspace((s) => s.selection);
  const select = useWorkspace((s) => s.select);
  const copySelection = useWorkspace((s) => s.copySelection);
  const deleteSelection = useWorkspace((s) => s.deleteSelection);
  const paste = useWorkspace((s) => s.paste);
  const clipboard = useWorkspace((s) => s.clipboard);
  const readOnly = useReadOnly();
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
  const workspaceSession = () => canvasStore.getState().session;
  const openFile = useWorkspace((s) => s.openFile);
  const apply = useWorkspace((s) => s.apply);
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
      selection={selection}
      onSelectNode={(id) => void select(id)}
      onCopy={readOnly ? undefined : () => void copySelection()}
      onDelete={readOnly ? undefined : () => void deleteSelection()}
      pasteNodes={clipboard?.nodes ?? null}
      onPaste={readOnly ? undefined : () => void paste(centreOfCanvas())}
      diagnostics={diagnostics}
      registry={registry}
      configPath={rootConfig}
      onOpenConfig={(path) => void openFile(path)}
      onAddPort={
        readOnly || file?.kind !== "workflow"
          ? undefined
          : async (role, name, type) => {
              const target = { path: file.path, workflow: file.workflow };
              const session = workspaceSession();
              const outcome = await apply(
                role === "take"
                  ? { kind: "addTake", target, name, type }
                  : { kind: "addEmit", target, name, type },
                session,
              );
              return outcome.ok ? null : outcome.message;
            }
      }
      onShowProblems={(first) =>
        problemsStore.getState().show(problemsView(first), problemKey(first))
      }
    />
  );
}
