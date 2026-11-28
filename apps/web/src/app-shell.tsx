import { installedPackVersions } from "@nf-builder/engine";
import type { JSX } from "react";
import { type CanvasContent, useWorkspace } from "./canvas/canvas-store";
import { DetailsHeader } from "./details/details-header";
import { DetailsPane } from "./details/details-pane";
import { useHistoryKeys } from "./history/use-history-keys";
import { COLLAPSED_WIDTH, useLayout } from "./layout/layout-store";
import { ProblemsPanel, problemsTabId } from "./problems/problems-panel";
import { useProblems } from "./problems/problems-store";
import { ProjectControls } from "./project/project-controls";
import { saveLabel } from "./project/project-status";
import { useProjects } from "./project/project-store";
import { ReadOnlyNote } from "./read-only/read-only-note";
import { useReadOnly } from "./read-only/read-only-store";
import { AppHeader } from "./shell/app-header";
import { ColumnSeparator } from "./shell/column-separator";
import { LeftColumn } from "./shell/left-column";
import { SideColumn } from "./shell/side-column";
import { StatusBar, type StatusProblems } from "./shell/status-bar";
import { TabStrip } from "./shell/tab-strip";
import { TabPanel } from "./views/tab-panel";
import { useViewModeKeys } from "./views/use-view-mode-keys";

const languageVersions = installedPackVersions();

/** The status bar's counts: the nodes and channels of the active canvas (UX-03). */
export function canvasCounts(content: CanvasContent): {
  nodes: number;
  channels: number;
} {
  return content.status === "ready"
    ? {
        nodes: content.projection.nodes.length,
        channels: content.projection.edges.length,
      }
    : { nodes: 0, channels: 0 };
}

/** The status bar's problems: null with no project (plain text), else the store's counts and the panel's tab. */
function useProblemsStatus(hasProject: boolean): StatusProblems | null {
  const status = useProblems((s) => s.status);
  const sections = useProblems((s) => s.sections);
  const message = useProblems((s) => s.message);
  const open = useProblems((s) => s.open);
  const view = useProblems((s) => s.view);
  const toggle = useProblems((s) => s.toggle);
  if (!hasProject) return null;
  return {
    status,
    counts: sections.counts,
    message,
    open: open ? view : null,
    onToggle: (v) => {
      const opening = !(open && view === v);
      toggle(v);
      // opening moves the focus to the tab, once the panel has rendered
      if (opening)
        setTimeout(() => document.getElementById(problemsTabId(v))?.focus(), 0);
    },
  };
}

export function AppShell(): JSX.Element {
  useViewModeKeys();
  useHistoryKeys();
  const readOnly = useReadOnly();
  const left = useLayout((s) => s.left);
  const right = useLayout((s) => s.right);
  const leftWidth = left.collapsed ? COLLAPSED_WIDTH : left.width;
  const content = useWorkspace((s) => s.content);
  const onFile = useWorkspace(
    (s) => s.tabs.find((t) => t.id === s.activeTab)?.kind === "file",
  );
  const counts = onFile ? null : canvasCounts(content);
  const hasProject = useWorkspace((s) => s.summary !== null);
  const diagnostics = useProblemsStatus(hasProject);
  const projects = useProjects((s) => s.status);
  const storageWarning = useProjects((s) => s.storageWarning);
  const persisted = useProjects((s) => s.persisted);
  const showDialog = useProjects((s) => s.showDialog);
  const rightWidth = right.collapsed ? COLLAPSED_WIDTH : right.width;
  return (
    <div className={readOnly ? "app-shell is-read-only" : "app-shell"}>
      <AppHeader
        readOnly={readOnly}
        languageVersions={languageVersions}
        projectControls={<ProjectControls />}
        saveLabel={saveLabel(projects.current !== null, projects.save)}
        saveFailed={
          projects.save.status === "failed" ? (projects.save.error ?? "") : null
        }
        storageWarning={storageWarning}
        storageNote={persisted === false}
        onTemplates={() => showDialog({ kind: "new", route: "template" })}
      />
      <ReadOnlyNote />
      <div
        className={readOnly ? "app-columns is-read-only" : "app-columns"}
        style={
          readOnly
            ? undefined
            : {
                gridTemplateColumns: `${leftWidth}px minmax(0, 1fr) ${rightWidth}px`,
              }
        }
      >
        {readOnly ? null : <LeftColumn languageVersion={languageVersions[0]} />}
        {readOnly || left.collapsed ? null : (
          <ColumnSeparator side="left" label="Resize components and files" />
        )}
        <main className="column column-centre" aria-label="Canvas and editor">
          <TabStrip />
          <TabPanel />
          <ProblemsPanel />
        </main>
        {readOnly || right.collapsed ? null : (
          <ColumnSeparator side="right" label="Resize details" />
        )}
        <SideColumn
          side="right"
          label="Details"
          header={<DetailsHeader />}
          collapsible={!readOnly}
        >
          <DetailsPane />
        </SideColumn>
      </div>
      <StatusBar
        diagnostics={diagnostics}
        nodes={counts?.nodes ?? null}
        channels={counts?.channels ?? null}
        languageVersion={languageVersions[0]}
      />
    </div>
  );
}
